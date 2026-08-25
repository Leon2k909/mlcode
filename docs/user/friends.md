# Friends

A friend is a coworker running their own copy of ML Code, linked directly to yours. Once you are
linked you can share a chat with them, and both of you sit in the same conversation: you see each
other's messages, you both watch the agent work, and either of you can type.

There is no account to make and no server in the middle. The two apps talk to each other.

## Adding a friend

Open **Settings → Friends**.

1. Choose **Create code**. You get a friend code that looks like `mlfriend1_…`.
2. Send it to them however you normally talk — chat, email, whatever.
3. They paste it into the **Add a friend** box on their machine and choose **Link**.

The code works once and expires after a week. Treat it like a password while it is unused: whoever
holds it can link to you.

Both of you need to be able to reach each other over the network — the same office LAN, a VPN, or a
Tailscale network all work. If only one side is reachable, the link finishes in one direction and
your friends list says **Link incomplete**; swapping a fresh code from the other side fixes it.

### How you appear

The same page carries your display name and color. That is what your friends see next to anything
you say. It starts as your computer's name, so it is worth changing to something they will recognise.

## Sharing a chat

Every chat has a share button in its header, next to the project controls. Open it and pick a level
for each friend:

- **Off** — they cannot see this chat at all. This is the starting point for every chat.
- **Can watch** — they see the conversation and the agent's replies, and cannot type.
- **Can chat** — they can also send messages, which the agent answers like your own.

The button shows the faces of everyone the chat is currently shared with, so you can tell at a
glance whether a conversation is private.

Turning a friend back to **Off** ends it immediately: their view closes and tells them the chat is
no longer shared.

## Reading a chat somebody shared with you

A **Shared with me** button appears in the sidebar once you have friends. It lists each friend and
the chats they are currently sharing. Open one and you get the conversation live: messages arrive as
they are written, the agent's replies stream in as they are generated, and every message shows who
wrote it.

If the chat was shared as **Can chat**, there is a composer at the bottom. What you send arrives in
your friend's chat labelled with your name, and the agent treats it like any other request — so if a
turn is already running, your message queues behind it exactly as theirs would.

When your friend closes their laptop the room goes quiet and reconnects on its own when they are
back.

## What a friend can and cannot reach

This is the part worth being precise about, because you are giving somebody a window into your
machine.

A friend can see:

- the chats you shared with them, and nothing else;
- the messages in those chats, from you, from them, and from the agent;
- whether the agent is working, and whether it is waiting on you for permission.

A friend cannot:

- see any other chat, project, or workspace on your machine;
- open a terminal, read a file, browse your filesystem, or run a script;
- see your settings, your providers, or your other friends;
- approve anything. When the agent asks permission to run a command, that decision is yours alone.
  Your friend is told you are being asked; they never get the buttons.

Sharing with **Can chat** does mean that friend can ask your agent to do work in that chat, and your
agent runs on your machine. Share those with people you would let use your keyboard, and keep an eye
on your permission mode: a chat set to approve everything automatically will do what they ask
without checking with you.

## Removing a friend

**Settings → Friends → Remove** cuts the link in both directions at once. Their credential stops
working immediately, any chat you shared with them closes, and they disappear from your list. If you
want them back later, swap a fresh code.
