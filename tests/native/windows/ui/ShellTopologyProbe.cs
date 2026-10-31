using WorkFleet.Windows;

internal static class ShellTopologyProbe
{
  public static void Run()
  {
    var classic = new Windows();
    classic.Add(1, "Progman"); classic.Add(2, "SHELLDLL_DefView", parent: 1);
    classic.Add(3, "WorkerW");
    Check(NativeShellLayers.Discover(classic) == new NativeShellLayers(1, 3, 1), "classic sibling below Progman");
    Check(classic.Requests.Count == 0, "healthy classic host needs no creation request");

    var moved = new Windows();
    moved.Add(1, "Progman"); moved.Add(3, "WorkerW"); moved.Add(2, "SHELLDLL_DefView", parent: 3);
    moved.Add(4, "WorkerW");
    Check(NativeShellLayers.Discover(moved) == new NativeShellLayers(3, 4, 1), "classic icons moved into a WorkerW");

    var modern = new Windows();
    modern.Add(1, "Progman"); modern.Add(3, "WorkerW", parent: 1); // Above icons, not wallpaper.
    modern.Add(2, "SHELLDLL_DefView", parent: 1);
    modern.Add(4, "WorkerW", parent: 1, process: 99); modern.Add(5, "WorkerW", parent: 1, visible: false);
    modern.Add(6, "WorkerW", parent: 1); modern.Add(7, "WorkerW");
    Check(NativeShellLayers.Discover(modern) == new NativeShellLayers(1, 6, 1), "modern child below icons, preferred over sibling");
    Check(modern.Requests.Count == 0, "healthy modern host needs no creation request");

    var invalid = new Windows();
    invalid.Add(8, "WorkerW"); // A WorkerW above the icon host cannot be wallpaper.
    invalid.Add(9, "Other", process: 99); invalid.Add(10, "SHELLDLL_DefView", parent: 9, process: 99);
    invalid.Add(1, "Progman"); invalid.Add(2, "SHELLDLL_DefView", parent: 1);
    invalid.Add(3, "WorkerW", process: 99); invalid.Add(4, "WorkerW", visible: false);
    invalid.Add(5, "WorkerW"); invalid.Add(6, "SHELLDLL_DefView", parent: 5);
    Check(NativeShellLayers.Discover(invalid) == new NativeShellLayers(1, 0, 1), "reject foreign, hidden, icon and above-icon hosts");
    Check(invalid.Requests.SequenceEqual(new[] { (13, 0), (13, 1), (0, 0) }), "missing host has only three bounded creation requests");

    var created = new Windows();
    created.Add(1, "Progman"); created.Add(2, "SHELLDLL_DefView", parent: 1);
    created.OnRequest = () => { if (created.Requests.Count == 2) created.Add(3, "WorkerW"); };
    Check(NativeShellLayers.Discover(created) == new NativeShellLayers(1, 3, 1) && created.Requests.Count == 2,
      "rediscover after creation and stop once the real host exists");

    var missing = new Windows { Progman = 0 };
    missing.Add(3, "WorkerW");
    Check(NativeShellLayers.Discover(missing) == new NativeShellLayers(0, 0, 0) && missing.Requests.Count == 0,
      "absent Explorer never selects an arbitrary WorkerW");
    missing.Progman = 1; missing.Add(1, "Progman");
    Check(NativeShellLayers.Discover(missing) == new NativeShellLayers(0, 0, 1), "absent icon host does not imply wallpaper capability");

    var healthy = NativeShellLayers.Discover(classic);
    Check(!healthy.HasChanged(classic), "healthy host does not trigger periodic reattachment");
    classic.Nodes[3].Alive = false;
    Check(healthy.HasChanged(classic), "destroyed wallpaper triggers recovery");
    classic.Nodes[3].Alive = true; classic.Nodes[1].Alive = false;
    Check(healthy.HasChanged(classic), "destroyed icon host triggers recovery");
    classic.Nodes[1].Alive = true; classic.Progman = 12;
    Check(healthy.HasChanged(classic), "replacement Explorer triggers recovery");
    classic.Progman = 1; classic.Nodes[3].Alive = false; classic.Add(11, "WorkerW");
    Check(NativeShellLayers.Discover(classic) == new NativeShellLayers(1, 11, 1), "rediscovery rejects destroyed host and finds replacement");

    // ADR-060: only (13, 1) makes Explorer draw the wallpaper again; nothing is sent without a living wallpaper host.
    var painted = new Windows();
    painted.Add(1, "Progman"); painted.Add(2, "SHELLDLL_DefView", parent: 1); painted.Add(3, "WorkerW");
    var layers = NativeShellLayers.Discover(painted);
    Check(layers.RepaintWallpaper(painted) && painted.Requests.SequenceEqual(new[] { (13, 1) }), "wallpaper repaint sends (13, 1) to Progman");
    painted.Requests.Clear(); painted.Nodes[3].Alive = false;
    Check(!layers.RepaintWallpaper(painted) && painted.Requests.Count == 0, "no wallpaper repaint once the host is gone");
    Check(!(layers with { Wallpaper = IntPtr.Zero }).RepaintWallpaper(painted) && !new NativeShellLayers(0, 0, 0).RepaintWallpaper(painted)
      && painted.Requests.Count == 0, "no wallpaper repaint without a wallpaper host or Explorer");
  }

  private static void Check(bool condition, string description)
  {
    if (!condition) throw new Exception("Shell topology: " + description);
    Console.WriteLine("PASS shell topology: " + description);
  }

  private sealed class Node(string name, IntPtr parent, uint process, bool visible)
  {
    public string Name = name;
    public IntPtr Parent = parent;
    public uint Process = process;
    public bool Visible = visible;
    public bool Alive = true;
  }

  private sealed class Windows : IShellWindows
  {
    public IntPtr Progman { get; set; } = 1;
    public readonly Dictionary<IntPtr, Node> Nodes = [];
    private readonly List<IntPtr> order = [];
    public readonly List<(int, int)> Requests = [];
    public Action? OnRequest;
    public void Add(int handle, string name, int parent = 0, uint process = 42, bool visible = true)
    {
      Nodes.Add(handle, new(name, parent, process, visible)); order.Add(handle);
    }
    public IEnumerable<IntPtr> TopLevel() => order.Where(window => Nodes[window].Parent == IntPtr.Zero && Alive(window));
    public IntPtr FindChild(IntPtr parent, IntPtr after, string name) => order.Skip(after == IntPtr.Zero ? 0 : order.IndexOf(after) + 1)
      .FirstOrDefault(window => Nodes[window].Parent == parent && Nodes[window].Name == name && Alive(window));
    public IntPtr Next(IntPtr window) => order.Skip(order.IndexOf(window) + 1)
      .FirstOrDefault(next => Nodes[next].Parent == Nodes[window].Parent && Alive(next));
    public uint Process(IntPtr window) => Nodes.TryGetValue(window, out var node) ? node.Process : 0;
    public bool Visible(IntPtr window) => Alive(window) && Nodes[window].Visible;
    public bool Alive(IntPtr window) => Nodes.TryGetValue(window, out var node) && node.Alive;
    public void RequestWallpaper(IntPtr shell, int wParam, int lParam)
    {
      Check(shell == Progman, "creation request targets Progman");
      Requests.Add((wParam, lParam)); OnRequest?.Invoke();
    }
  }
}
