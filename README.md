# Ghost Town

A walkable picture of downtown Bushnell, Illinois, around 1880. You move along the dirt streets, past the boardwalks and the brick stores, and you can rise up and look down on the railroad crossing.

The town is the real street grid. East Main and West Main are the wide streets on either side of the Chicago, Burlington & Quincy tracks. Hail Street and Hurst Street cross them in the middle of downtown. Some buildings are named from the old county histories. Others are the right kind of building for that block, and they are marked that way so they can be corrected later.

## Run it on a Mac

You need Node.js, the free tool that runs this project. If you do not have it, install the LTS version from [https://nodejs.org](https://nodejs.org). Then open the Terminal app and go into this project folder. If the folder is on your Desktop and is named Ghost Town, the commands look like this:

```bash
cd ~/Desktop/Ghost\ Town
npm install
npm run dev
```

`npm install` only has to be done once. It downloads the 3D library. `npm run dev` starts a small local web server.

When the terminal says the server is ready, open a browser to:

[http://localhost:4179/ghost-town/](http://localhost:4179/ghost-town/)

Leave the terminal window open while you walk around. Press Control-C in that window when you want to stop.

To make a copy you can open without the development server:

```bash
npm run build
npm run preview
```

Then open [http://localhost:4179/ghost-town/](http://localhost:4179/ghost-town/) again.

The published copy is at [https://mcr-game-project.github.io/ghost-town/](https://mcr-game-project.github.io/ghost-town/).

## How to move around

- Click **Start walking**. Then move the mouse to look around.
- **W** walks forward, **S** back, **A** left, **D** right. The arrow keys do the same.
- Hold **Shift** to walk faster.
- You can also drag the picture with the mouse if you would rather not capture the pointer.
- Press **Esc** or **Q** to let go of the mouse and bring the menu back. After the mouse is free, **Stop walking** does the same.
- Press **M**, or **See the whole town**, to rise above the streets and orbit. Drag to turn. Press **M** again, or **Walk the streets**, to come back down.
- The **Go to** menu puts you at the depot, German row, the parks, or the railroad crossing.
- Look at a building and a card in the corner tells you what it is. A card that says “Named in the old records” comes from a history or a map. A card that says “A stand-in for this block” is a plausible shop or house, not a specific one we can prove.

On a phone or tablet, buttons for forward, back, left, and right appear at the lower left. Drag the picture to look.

## Changing a building

The buildings live in `public/data/bushnell-1880.json`, not in the program. Edit that file, save it, and refresh the browser.

Each building has a name, a use (general store, hotel, livery, and so on), a material (`brick` or `frame`), a number of stories, and a footprint in feet. `width` runs along the front. `depth` runs back from the street. `x` and `z` are the center of the building. Positive `x` is northeast along the tracks, toward Gridley Street. Positive `z` is the west side of town, toward West Main and Dean. `confidence` is `sourced` or `inferred`. The `notes` field says why.

`SOURCES.md` explains what is taken from the old maps and histories, and what was filled in.

There is also a script, `scripts/build-town-data.py`, that can rebuild the JSON from scratch. Running it replaces any edits you have made to the JSON. Use it only if you want the original layout back. Then run:

```bash
npm run data
```
