# Hangman

A very small first project: the classic Hangman word-guessing game, drawn on a chalkboard.

## What's in here

- `index.html` — the whole game in one file. It contains three things:
  - **HTML** — the structure of the page (the title, the drawing, the buttons)
  - **CSS** (the `<style>` part) — how everything looks (colors, fonts, layout)
  - **JavaScript** (the `<script>` part) — what makes it work (picking a word, checking your guesses)

## How to run it

No installation, no tools, no terminal. Just open `index.html` in any web browser —
double-click the file, or drag it onto a browser window. That's it.

## How to play

- The dashes are the hidden word — one dash per letter.
- Click a letter (or type it on your keyboard) to guess.
- A right guess fills in the word; a wrong guess draws one more piece of the figure.
- Six wrong guesses and the round is lost. Hit **Play again** for a new word.

## Ideas to try changing

Open `index.html` in any text editor and experiment — you can't break anything
that a fresh copy won't fix:

- Add your own words to the `WORDS` list.
- Change the chalk colors at the top of the `<style>` section.
- Change `MAX_MISSES` from 6 to make the game easier or harder.
