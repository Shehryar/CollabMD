# user journeys

collabmd bridges two worlds: local markdown files and a collaborative web editor. the product's identity is that both are first-class. not "web with optional local sync" and not "local tool with optional web view." both paths are equally valid ways to use collabmd, and the UX should present them that way from day one.

this document maps the two entry points, the hybrid middle ground, and what the onboarding and UI should look like.

---

## 1. web-first users

these users sign up, create docs in the browser, collaborate with teammates. they might never touch a terminal. the product works fully for them.

### current problem

the getting-started checklist has 5 items in a flat list. two of them ("install the CLI" and "link a local folder") feel mandatory even though the web editor works standalone. the progress bar reads "2 of 5 complete" after they've done everything relevant. feels broken.

### what should change

the web path needs to feel complete on its own, not like a partial setup. but the local path should still be visible and inviting, not buried.

---

## 2. local-first users

these users found collabmd because they want to keep editing .md files in vim, vscode, or whatever. they want their files on disk, version-controlled, portable. the web editor is the collaboration layer on top.

these users might install the CLI before they even open the web app. or they discover collabmd through `create-collabmd` and the web comes second.

### how connected folders appear in the web UI

when a daemon links a folder, documents from that folder appear in the sidebar like any other documents. they need a visual distinction but not a degraded experience.

each synced document shows a small indicator: a sync icon or "local" label in muted type. folders connected via the daemon show a "synced" badge in the folder tree. tooltip on hover shows the local path: `~/projects/collabmd`.

### sync status

the sidebar shows a compact sync status for connected users:

- green dot + "synced" when the daemon is connected and current
- yellow dot + "syncing..." during active sync
- gray dot + "offline" when the daemon connection drops
- timestamp: "last synced 2 min ago"

this only appears for users who have at least one connected folder.

### daemon goes offline

documents synced from local folders remain fully editable in the web editor. nothing breaks. CRDT merge handles conflicts on reconnect.

if a user opens a synced doc while the daemon is offline, a small notice in the editor: "local sync paused, editing in web." informational, not a warning.

---

## 3. hybrid experience

most users will end up here. some docs synced from `~/notes/`, some created in the browser, shared docs from teammates. the UI needs to handle all three cleanly.

### visual distinction

synced documents get a "local" badge. web-only documents are undecorated. this keeps the UI clean since the badge is additive information, not a warning.

in the document list:

- no tag = created in web
- sync icon or "local" label = synced from a connected folder
- hover shows the local file path

### folder tree

connected folders show their sync status individually:

- connected indicator (small dot or icon on the folder)
- web-only folders look normal
- if a connected folder's daemon goes offline, its indicator turns gray

### document metadata

the document detail view should show:

- local path (if synced): `~/notes/project/readme.md`
- sync status: connected / offline / last synced
- source: "synced from CLI" vs "created in web"

---

## 4. onboarding: two paths, one flow

the current onboarding funnels everyone into the same 5-step checklist. that's the core problem. the fix isn't to hide the local path from web users. it's to let people choose their path upfront and make both feel complete.

### the choice

on first login (or in the onboarding wizard), present two cards side by side:

**"write in the browser"**
start creating and sharing documents right now. no installation needed.

**"sync local files"**
edit .md files on your machine. collabmd syncs them to the web for collaboration.

these are equal-weight choices. same size cards, same visual prominence. neither is "recommended" or "advanced."

### web-first checklist (3 items)

if the user picks "write in the browser" (or just starts using the app without choosing):

1. name your workspace
2. create your first document
3. invite a teammate

progress: "X of 3 complete." the checklist feels done when it is. but a small persistent link stays visible: "want to edit locally too? connect a folder." this is an invitation, not a nag.

### local-first checklist (4 items)

if the user picks "sync local files":

1. install the CLI
2. authenticate
3. link a local folder
4. name your workspace

progress: "X of 4 complete." the /connect page opens naturally as part of this flow. once the daemon is connected, the user sees their local files appear in the web UI. magic moment.

after completing this path, the sidebar shows sync status and connected folders. the user can also create web-only docs at any time.

### the connect page

/connect stays as a standalone guided setup page. it's well-built. but it should serve both paths:

- local-first users land here as part of their onboarding flow
- web-first users can find it later via workspace settings, sidebar "connect folder" link, or the persistent "edit locally too?" prompt
- it should always be one click away, never hidden, but never forced

---

## 5. sidebar behavior

### for web-first users (no connected folders)

- folder tree shows web folders only, no sync indicators
- no sync status section
- "connect folder" link appears at the bottom of the folder tree, subtle but always visible
- getting-started checklist shows 3 items

### for connected users (1+ connected folders)

- folder tree shows all folders with sync indicators on connected ones
- sync status section appears near bottom of folder tree: `● synced · ~/projects · 2 min ago`
- "connect folder" link changes to "manage connections" or just stays as-is
- getting-started checklist shows local-first items if they're still completing setup

### the "connect folder" sidebar link

currently this link conditionally appears based on checklist state. change it to always appear for all users as a lightweight entry point. position it at the bottom of the folder list, same visual weight as "Trash":

```
All documents
Shared with me

FOLDERS
Design
Meeting Notes
Notes
Projects

Trash
Connect folder    <- always visible, for everyone
```

this is how the local path stays discoverable without being aggressive. clicking it goes to /connect.

---

## 6. what not to do

- don't gate any web feature behind CLI installation
- don't gate any local feature behind web signup (CLI should work with just auth)
- don't treat either path as "advanced" or "optional"
- don't hide the connect flow from web users
- don't push the connect flow on web users who haven't asked
- don't show sync indicators to users with no connected folders
- don't require both paths to be complete before the checklist clears

---

## summary

collabmd's differentiator is that both local files and web editing are real, first-class experiences. the onboarding should present a clear choice between the two paths, not funnel everyone into one. the sidebar and document list should adapt to whichever path (or combination) the user has chosen. both paths feel complete on their own, and upgrading from one to both is always one click away.
