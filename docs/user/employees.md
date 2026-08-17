# Employees

An employee is a named teammate in ML Code: a name, an avatar, a role, and a set of standing
instructions. Employees do the work through the providers you have already set up, so an employee is
a _who_, not a new agent to install.

## Creating one

Open **Settings → Employees** and choose **Add employee**.

- **Name** — what the employee is called. The ID fills itself in as you type, and you can change it.
- **Role** — a short title, like "Frontend engineer". Shown next to the name.
- **Avatar** — an emoji. Falls back to initials if you leave it empty.
- **Runs on** — which provider does the work. Several employees can share one provider, so a single
  Claude or Codex setup can back a whole team.
- **Model override** — pins this employee to one model. Leave it blank to use whatever the thread is
  set to.
- **Standing instructions** — how this employee works. Up to 8,000 characters.

Toggle an employee off to keep them configured but idle.

## Private work chats

Every thread has an employee picker in the composer, next to the model picker. Choose an employee
and their instructions open the conversation; choose **No employee** to work without one. The
thread is routed to the provider and model assigned to that employee, even if a different provider
was previously selected in the composer.

A private work chat has one employee. They work on your request and reply to you normally; no other
employee is told about the thread.

## Group chats

Start a new thread, open the employee picker, and choose **Start with everyone** or tick the people
you want in the group. The employee shown first in the picker takes the first turn.

Group members know the names, roles, and IDs of the other selected members. When one employee needs
another, they can hand over the same thread. The next employee receives a visible message from the
first, takes over through their own assigned provider and model, and continues in the same
workspace. This works across providers, so a Codex employee can hand work to a Claude employee and
vice versa.

Only employees selected for that group can take part. Employee replies show their name and role,
and a handoff is marked in the timeline so the conversation reads like a small Slack or Teams
channel rather than one anonymous agent.

The default CEO is routing-only in a group: it chooses a worker before any tool use. If it attempts
a tool instead of handing off, ML Code blocks that tool and continues the request automatically
with an enabled worker rather than ending the conversation.

The composer and sidebar list the employees by name. If you change the group while an employee is
already working, the picker says **Next turn**: the running turn keeps its original membership, and
your new group applies when you send the next message.

To avoid two agents talking forever, a group pauses after eight consecutive employee-to-employee
turns. Send another message to continue.

The picker only appears once you have at least one employee, so nothing changes if you do not use
the feature.

## Employees and provider subagents

Employees are durable named teammates that stay in the main chat. Their replies are labeled
**Employee**, and a real transfer is labeled **Employee handoff**.

Codex and Claude can also create temporary subagents while completing one employee's turn. The app
labels those workers **provider subagents** and shows them in the Provider subagents panel. A plan
step that mentions an employee is marked **planned**; the employee has not started until an actual
employee handoff appears.

## How instructions are delivered

Standing instructions are sent when an employee first takes over a provider conversation — not with
every message. The agent keeps them in context, so repeating them would only crowd out your actual
request. A different employee taking over is introduced with their own identity and instructions.

If a session restarts and cannot resume its previous conversation, the instructions are sent again
so the employee never loses track of who they are.

## When a provider goes missing

An employee bound to a provider you no longer have configured is flagged in Settings and will not
pick up work. Nothing is deleted — set up that provider again, or point the employee at a different
one, and they carry on.

If a thread refers to an employee that has since been deleted, the thread still runs. It simply runs
without a persona rather than failing.
