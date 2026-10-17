# Lightweight project management experience and view model research

> 2026-10-04 validity update: this document is kept as historical research; it is not the current 1.0 interaction contract.
> The user has since moved to one card per thing, general-purpose groups, explicit formation and temporary z-order;
> the old Note container, per-item task model or other candidate UX must not override
> [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md).
> The reasons for the change are in [the same-day summary](2026-10-04-desktop-card-interaction-design.md).

- Date: 2026-10-03
- Status: research and candidate design; no PM service or data schema has been chosen.
- Premise: [backlog-first requirements](2026-10-03-backlog-first-product-requirements.md) take precedence.

## 1. Research question

How can the organizing power of mainstream project management tools be kept within a note-style quick-capture experience? The user named Trello, Linear, Plane, Monday, ClickUp, Wrike, Jira and Asana as references; this does not mean copying their features one by one or integrating all of these services.

This session picked a small number of official sources to confirm concepts worth borrowing; it did not complete a feature, pricing, license or API comparison of all the products above.

## 2. What the external products offer as reference

| Reference | Concept confirmable from official sources | Lesson for this project |
|---|---|---|
| Trello | Boards, lists and cards organize work | Visible cards and simple organizing operations |
| Plane | A work item is the unit of work, organized through different views | Work data and on-screen presentation can be separated |
| GitHub Projects | Issues/PRs can be shown in different views by fields, filters and grouping | The same data need not be copied for each screen |
| Linear | A human assignee and an agent delegate can be separate | Agent information can be added without replacing the user's ownership of the task |

Sources: [Trello help](https://support.atlassian.com/trello/docs/using-trello/), [Plane work items](https://docs.plane.so/work-items/overview), [GitHub Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects), [Linear assignment](https://linear.app/docs/assigning-issues).

These products' Project, Team and Board do not map one to one. This document borrows concepts; it does not claim they use the same data hierarchy.

## 3. What suits the default

- Quick add and direct editing.
- Simple unfinished/done operations, and an optional in-progress marker.
- The same work data can be viewed as notes, a list or a status kanban board.
- Your own preferred filters, sorting and grouping can be saved.
- Free text and work content have an easy-to-understand relationship.
- Completed items and accidentally deleted content can be found again.

Something should not enter the first version just because other PM tools have it: sprints, estimates, capacity management, time tracking, Gantt charts, complex approvals and multi-level workflows each need an independent reason to exist.

## 4. Candidate concept boundaries

| Concept | Purpose | Does the default require the user to set it up |
|---|---|---|
| Note | Holds one work context, its description and to-dos | Only a simple name, or just start writing |
| Item | Work that can be completed, moved and referenced on its own | Internal IDs are not exposed |
| Project | Gathers work for one goal or product | Optional; never blocks capturing an idea |
| Environment | Machine- or platform-related context | Assigned only when needed |
| View | Saves display scope, grouping and sorting | A default is provided; advanced users adjust it later |
| Device layout | Each device's note positions, sizes and highlighting | Kept separate from the shared work content |

This is a design vocabulary, not a requirement to create six data tables right away. Implementation should use the smallest model that supports the validated experience.

## 5. Difference between note content and query results

Example 1: "Ideas this week" is a note you write in directly, with a short description and a few to-dos.

Example 2: "Unfinished items on this Mac" might be a filter result drawn from several projects.

Both screens might look like a note. If they are allowed to coexist, the following must be defined clearly:

- When adding an item, which actual place does it go into?
- Removing an item from a filter result: does that change its home, remove a tag or delete it?
- When the same item appears in several places, how does its completion state stay consistent?
- Does free text follow the view, or belong to the original note?
- Does hiding something on a device affect only that device?

Avoid implementing sync by "each screen stores its own copy of the text"; that makes the same thing gradually drift into different versions.

## 6. Machines, teams and agents

The user's development machines can host several CLI agents, co-editing or using worktrees, and can collaborate across machines through GitHub. This is a valid product context.

machine = team = project should not be fixed as one concept. One machine can work on several projects, and one project can span machines. The first version can make it just an environment tag or a note's home, with no full team management.

If execution integration comes later, extra information on "which agent handles this item in which environment" can be added. Linear's Agent Session offers a reference for tracking an execution lifecycle outside the task itself; the related API is currently marked Developer Preview officially and cannot be treated as a fixed protocol. [Linear Agent documentation](https://linear.app/developers/agents)

## 7. Deferred proposals

Earlier research proposed execution states such as Queued, Running, Waiting for input, Succeeded, Failed and Cancelled. The user pointed out that this would get in the way of the main use.

Therefore:

- These states do not appear in the default backlog.
- They are not required for the first version, and not every task needs an execution session.
- Even if automation comes later, information density and the display entry point should be researched separately.
- An agent finishing one run and the user considering the work done can keep different meanings.

"Needs me" could become an optional view in future; it has not been confirmed as the default home screen.

## 8. Limits of Git collaboration

Git worktree lets one repository have several working directories, with part of the Git data still shared. [Git worktree documentation](https://git-scm.com/docs/git-worktree)

Design inference: version control, task records and real-time co-editing are different problems. GitHub cannot decide for this product who overwrites whom when two phones change a to-do's text at the same time, nor does it automatically coordinate several agents writing to the same working directory.

This limit should be written into future integration designs, but should not turn into a locking procedure that backlog users have to operate.

## 9. Candidate prototypes and how to compare them

Test with the same set of real work content:

1. Board: one note per context, with direct adding.
2. Flat list: unfinished items shown together, optionally grouped by context.
3. Three-column kanban board: Todo/In Progress/Done.

Compare the steps to record something, how hard it is to find content again the next day, information density and usability on a phone. Settle the main default first, then decide whether a custom view syntax or several backends are needed.

## 10. Conclusion of this session

Keep mainstream PM's concepts of independent work items and multiple views; the product default centres on quick capture, constant reminders and simple completion. Whether an existing PM system suits as the backend needs real testing against the same experience scenarios and is not yet decided.
