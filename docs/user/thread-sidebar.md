# Organizing threads

## Possibly stuck workers

ML Code changes **Working** to **Possibly stuck** after an active worker has reported no messages,
tool activity, or session progress for ten minutes. This is only a warning: long commands can be
quiet, so ML Code never retries the worker or hands the task to another employee automatically.

Open the thread to keep waiting or stop the worker. If the provider does not acknowledge Stop,
**Force stop session** appears after a short wait. Do not start replacement work until the session
has confirmed shutdown; this prevents two workers from repeating edits, commits, or releases.

Pin a thread from its context menu to keep it in the pinned section above your active work.
`mod+shift+p` pins or unpins the thread you have open. Pinned threads are shown independently of
their project, including when you connect to more than one environment.

To require confirmation before unpinning, enable **Settings → General → Unpin confirmation**. The
confirmation applies to the sidebar controls, thread menus, and the `mod+shift+p` shortcut.

Pinned threads still move to **Settled** when they become inactive. They also move when their pull
request merges if **Auto-settle merged threads** is enabled.

Each server stores its own copy of the automatic settlement settings and checks them even when no
web, desktop, or mobile client is connected. By default, it settles threads after three days without
activity and when their pull request merges. An eligible idle thread also settles when its pull
request closes. An open pull request blocks inactivity settlement. Active work, pending input, and
live background work keep the thread active. ML Code settles from a closed or merged pull request
only when its timestamp is not older than the user's latest activity. If that timestamp is not
available, the inactivity rule still applies. A manual un-settle also keeps the thread active.

**Settled** lists threads by when their work finished, newest first. A thread you settle yourself
sorts by the moment you settled it. A thread that settled on its own sorts by its last message or
turn, not by when the server noticed it was inactive.

Change these rules in **Settings > General**. The change is written to every connected environment
whose server supports shared settings. An environment that is offline or needs a server update
keeps its old value and does not appear in mismatch warnings. When a connected environment whose
server supports shared settings holds a different value, **Settings > General** shows a warning
that names it. Choose **Apply to all** to write your current values to the environments named in
the warning. The same applies to the new-thread workspace mode and the source control writing
style.

A settings change affects future settlement and does not reopen a settled thread. Settings saved
by older clients on one device no longer control this behavior.

When you un-settle a thread, it returns to the top of the active list so you can find it right
away. Its timestamps do not change. Other threads keep their positions.

Right-click a pull request link in a thread and choose **Link to thread** to show that pull request
in the sidebar. The thread settles when the linked pull request merges if **Auto-settle merged
threads** is enabled. Right-click the same link and choose **Unlink from thread** to remove it.

On web and desktop, drag a pinned thread to change its position. On mobile, open the thread's menu
and choose **Move up** or **Move down**. The order is stored by the server and appears on your
other connected devices.

If reordering is unavailable for one environment, update the ML Code server running in that
environment. Older servers can still pin and unpin threads, but do not understand synced ordering;
their pinned threads keep the default newest-first order below the ones you have arranged.

## Copying a thread

Open a thread's context menu and choose **Copy thread** to start a second conversation alongside
the first. The copy opens in the same project, on the same branch and workspace, with the same
model, employees, permission mode, and goal — so you can explore a second approach without losing
the thread you already have.

The copy starts with an empty transcript, but the agent is not starting from nothing: its first
reply is informed by a summary of the original conversation, so you can pick up where you left off
instead of re-explaining the task. Nothing is sent until you write your first message.

Checkpoints are not copied. The copy builds its own history from its first turn, and rewinding in
one thread never affects the other. The option is hidden when the connected environment needs a
server update.

For the automatic version of the same handover, when a conversation approaches the provider's
context limit, see [Long threads](long-threads.md).

## Rewinding a message

Choose **Delete & rewind** below one of your messages to remove that message and everything after
it, then restore the files from the preceding checkpoint. The action remains available when the
agent turn was interrupted or failed. Stop an active turn before rewinding; the deletion cannot be
undone.

## Panel motion

The main sidebar, right panel, and terminal drawer open and close immediately by default. Under
**Settings → Appearance → Motion**, move the **Panel animations** slider above 0 ms to add motion.
The duration can be set up to 400 ms. Clicking the preview replays all three panel transitions; at
0 ms, it snaps between the same open and closed states.

## Environment icons

When you are connected to more than one environment, every thread that lives somewhere other than
the machine you are on wears a small icon for that machine at the end of its row: a server, a cloud
VM, a desktop, a laptop, a Mac mini, or a Mac Studio. In the hosted web app and the mobile app,
where every environment is remote, each row wears its machine so you can tell them apart at a
glance. The same icon appears wherever an environment is named: the thread tooltip, the command
palette, the "Run on" picker, the pull request server filter, the provider settings device tabs,
and the environment lists under **Settings → Connections**. On mobile it appears in the thread
lists, the archive, the new-task environment picker, and the Environments and storage settings.

Servers pick the icon themselves from the hardware they run on. A Mac reports its model, a Linux
machine reports its chassis type and whether it is a virtual machine, and anything without a usable
signal shows a generic server. To override it, open **Settings → Connections** and choose an icon
for that environment; **Automatic** goes back to what the server detected. The choice is stored on
that server, so every device that connects to it sees the same icon.

## Environment artwork

Dev and Nightly environments can identify themselves with artwork at the top of the sidebar and in
the send button. Choose **Artwork**, **Version pill**, or **None** in Settings under environment
identification. Artwork is recolored to match each built-in theme. Custom themes use the **Version
pill** fallback because their colors are not controlled by ML Code.

To generate a fresh title from the conversation, open a thread's context menu and choose
**Regenerate title**. While ML Code is generating it, the action reads **Regenerating…** and cannot
be selected again. The option is hidden when the connected environment needs a server update.
