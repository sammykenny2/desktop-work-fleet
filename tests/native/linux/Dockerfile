FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    python3 python3-gi python3-gi-cairo python3-cairo python3-cryptography \
    gir1.2-gtk-3.0 gir1.2-webkit2-4.1 gir1.2-secret-1 gir1.2-gtklayershell-0.1 \
    gir1.2-keybinder-3.0 gsettings-desktop-schemas xvfb xauth dbus-x11 \
    xfdesktop4 xfconf openbox pcmanfm libgl1-mesa-dri labwc grim wtype
