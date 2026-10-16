<!-- Copyright 2026 Federico Cesarini, Marco Sassarini. SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Written by Crow's release workflow at every release: edits made here are overwritten. -->

<p align="center"><img src="crow.png" width="112" alt="Crow"></p>

<h1 align="center">Crow</h1>

<p align="center"><b>Build your second brain in minutes.</b><br>
Crow turns the documents on your computer into a living wiki you can chat with.<br>
macOS · Windows · Linux</p>

<p align="center"><a href="#download"><b>Download Crow 0.1.0</b></a></p>

---

Crow is the desktop app for [llm-wiki-v2](https://github.com/crow-hq/llm-wiki-v2). It finds the documents on your
computer, files them into a wiki of Markdown notes (a folder per topic, a note per idea, linked to each other), and
lets you ask that wiki anything while its brain, the graph of everything you filed, stays on screen.

- **Five screens to start.** Crow counts your documents and shows where they live. You pick the folders, connect
  OpenRouter and choose a model, then see the cost and the time before anything is spent.
- **Safe to leave running.** Filing goes oldest first, so the newest facts win. It pauses at your spending limit and
  continues where it stopped after a restart. Files already filed, and duplicates, cost nothing again.
- **Chat with your knowledge.** Answers cite the notes they come from, and those notes light up in the brain.
  Follow-up questions are understood in context. Drop a file onto a folder of the brain to file it there.
- **Your files stay yours.** Crow reads only the folders you choose. The wiki is a folder of Markdown files on your
  computer. Your documents' text goes only to the models you pick, through your own OpenRouter account.

PDF, Word, PowerPoint, Excel, OpenDocument, Markdown and plain text are read; scanned PDFs without a text layer are
skipped.

## Download

Crow 0.1.0, released 16 October 2026:

| System | For | Download | Size |
|---|---|---|---|
| **macOS** | Apple silicon (M1 and later) | [Crow_0.1.0_aarch64.dmg](https://github.com/crow-hq/crow-desktop/releases/download/v0.1.0/Crow_0.1.0_aarch64.dmg) | 28 MB |
| **macOS** | Intel | [Crow_0.1.0_x64.dmg](https://github.com/crow-hq/crow-desktop/releases/download/v0.1.0/Crow_0.1.0_x64.dmg) | 30 MB |
| **Windows** | Installer (.exe) | [Crow_0.1.0_x64-setup.exe](https://github.com/crow-hq/crow-desktop/releases/download/v0.1.0/Crow_0.1.0_x64-setup.exe) | 27 MB |
| **Windows** | Installer for IT (.msi) | [Crow_0.1.0_x64_en-US.msi](https://github.com/crow-hq/crow-desktop/releases/download/v0.1.0/Crow_0.1.0_x64_en-US.msi) | 29 MB |
| **Linux** | AppImage, any distribution | [Crow_0.1.0_amd64.AppImage](https://github.com/crow-hq/crow-desktop/releases/download/v0.1.0/Crow_0.1.0_amd64.AppImage) | 111 MB |
| **Linux** | Debian, Ubuntu (.deb) | [Crow_0.1.0_amd64.deb](https://github.com/crow-hq/crow-desktop/releases/download/v0.1.0/Crow_0.1.0_amd64.deb) | 33 MB |
| **Linux** | Fedora, openSUSE (.rpm) | [Crow-0.1.0-1.x86_64.rpm](https://github.com/crow-hq/crow-desktop/releases/download/v0.1.0/Crow-0.1.0-1.x86_64.rpm) | 33 MB |

Every file of this version is on its [release page](https://github.com/crow-hq/crow-desktop/releases/tag/v0.1.0); older versions are under
[Releases](https://github.com/crow-hq/crow-desktop/releases). Once installed, Crow updates itself from here.

## Start

1. Install Crow and open it. The builds are not signed yet:
   - **macOS:** the first time, Control-click Crow → **Open** (or System Settings → Privacy & Security →
     **Open Anyway**). macOS asks once per folder before Crow may look into Documents, Desktop or Downloads.
   - **Windows:** SmartScreen asks: **More info** → **Run anyway**.
   - **Linux:** make the AppImage executable (`chmod +x Crow_*.AppImage`) and run it, or install the `.deb`.
2. Pick the folders Crow should read, or single files.
3. Press **Connect**: [OpenRouter](https://openrouter.ai) opens in your browser. Sign in (or make an account), press
   **Authorize**, and Crow gets a key of its own on your account. That page also lets you give the key a credit limit
   or an expiry; later, Settings → OpenRouter → **Manage this key on OpenRouter** opens it again, and **Sign out** makes
   Crow forget it.
4. Choose a model, check the cost, and start. You can chat with the wiki while it grows.

Already have an OpenRouter key? Crow also reads `OPENROUTER_API_KEY` from the environment, or from a `.env` file
(used when you have not signed in):

| System | `.env` file |
|---|---|
| macOS | `~/Library/Application Support/com.crowhq.crow/.env` |
| Windows | `%APPDATA%\com.crowhq.crow\.env` |
| Linux | `~/.config/com.crowhq.crow/.env` |

```
OPENROUTER_API_KEY=sk-or-v1-…
```

## What it costs

Crow is free. You pay OpenRouter for the models it uses. Before filing starts, Crow estimates the cost from
OpenRouter's current prices and the real size of each document you picked, and it stops on its own at your spending
limit ($10 unless you change it). With the default model, a typical document costs a fraction of a cent; a library of
thousands takes hours, so start with a folder or a recent date range and add more later.

## Something wrong?

- **Logs:** Settings → About → **Open logs**.
- **The wiki itself:** Settings → Library → **Show in Finder/Explorer**. It is a plain folder of Markdown files
  ([the format](https://github.com/crow-hq/llm-wiki-v2#the-wiki-on-disk)).
- **Linux, a blank window:** start Crow with `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
- **Bugs and ideas:** [issues](https://github.com/crow-hq/crow-desktop/issues).

## Credits and license

Crow is by Federico Cesarini and Marco Sassarini, the authors of llm-wiki-v2 and the
[CROW paper](https://doi.org/10.5281/zenodo.22898752). It is licensed under the GNU AGPL v3.0 or later; every
installer carries the licence and the notices of the components it ships.
