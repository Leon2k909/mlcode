# Organizing threads

## Possibly stuck workers

ML Code changes **Working** to **Possibly stuck** after an active worker has reported no messages,
tool activity, or session progress for ten minutes. This is only a warning: long commands can be
quiet, so ML Code never retries the worker or hands the task to another employee automatically.

Open the thread to keep waiting or stop the worker. If the provider does not acknowledge Stop,
**Force stop session** appears after a short wait. Do not start replacement work until the session
has confirmed shutdown; this prevents two workers from repeating edits, commits, or releases.

Pin a thread from its context menu to keep it in the pinned section above your active work.
Pinned threads are shown independently of their project, including when you connect to more than
one environment.

Pinned threads still move to **Settled** when they become inactive. They also move when their pull
request merges if **Auto-settle merged threads** is enabled.

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

## Rewinding a message

Choose **Delete & rewind** below one of your messages to remove that message and everything after
it, then restore the files from the preceding checkpoint. The action remains available when the
agent turn was interrupted or failed. Stop an active turn before rewinding; the deletion cannot be
undone.

## Environment artwork

Dev and Nightly environments can identify themselves with artwork at the top of the sidebar and in
the send button. Choose **Artwork**, **Version pill**, or **None** in Settings under environment
identification. Artwork is recolored to match each built-in theme. Custom themes use the **Version
pill** fallback because their colors are not controlled by ML Code.

To generate a fresh title from the conversation, open a thread's context menu and choose
**Regenerate title**. While ML Code is generating it, the action reads **Regenerating…** and cannot
be selected again. The option is hidden when the connected environment needs a server update.
