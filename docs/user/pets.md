# Pets

A pet is a small pixel character that lives beside your workspace. ML Code shows the pets already
installed on this machine by Codex and Micheon, and can install new ones from
[codex-pets.net](https://codex-pets.net/).

## Choosing one

Open **Settings → Pets**. The top section lists everything found on this machine:

- `%MICHEON_HOME%\pets`
- `%CODEX_HOME%\pets`
- `%CODEX_HOME%\avatars`
- Codex's built-in pets

Pick one to keep it beside your workspace, or choose **No pet** to hide it.

## Installing from Codex Pets

The **Browse Codex Pets** section below shows pets shared by the community. Search by name, sort by
popular or newest, and choose **Install** on any card. The sprite kit downloads into your Codex pets
folder and appears in the list above, ready to pick.

**Remove** takes it back out of that folder again.

## What installing actually does

Worth knowing, because a pet is a file somebody else made that ends up on your machine.

Installing downloads one archive from codex-pets.net and unpacks it into
`%CODEX_HOME%\pets\<pet-id>`. ML Code checks the archive before writing anything:

- it only ever downloads from codex-pets.net, and never from an address supplied by anything else;
- it only unpacks images and a `pet.json` manifest — nothing executable, and nothing that runs;
- it refuses any file that would land outside that pet's own folder;
- it refuses archives that are unreasonably large or contain too many files;
- if any of those checks fail, nothing is written at all.

So an installed pet is pictures and a small description of how to animate them. It is not code, and
nothing about installing one runs a program on your machine.

If a download fails, the pet simply does not appear. Nothing is left half-installed.
