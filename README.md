# Native Garden

A free web app for mapping a native garden in 3D. Each person signs in with Google and keeps their own gardens. For each garden you can:

- see every plant, feature and bed in 3D: real flower shapes (coneflowers, spikes, umbels, bells…), leaves and grass that sway in the wind, sky and sun, and the months changing blooms, fruit, seed heads, fall color and winter dormancy
- watch trees and shrubs grow: the **Growth** menu shows the garden 1, 2, 3, 5, 10 or 20 years from now
- add buildings, fences, walls, hedges, pergolas, decks, ponds and more, and beds of any shape with mulch, gravel, pavers, flagstone or lawn, raised or flush
- see **sun and shade**: a map of hours of direct sun across the garden for any month, and a time-of-day slider that moves the shadows
- run **Garden Check**: crowded trees, plants in the wrong light, plants too tender for your hardiness zone, thin bloom months, and gaps in food for bees, butterflies, caterpillars and birds
- follow a **care calendar**: planting, cutting back, pruning, watering and wildlife jobs for each month, worked out from what's planted
- track what's in bloom now, check a bloom calendar for gaps, and keep an inventory
- see **Natives near you**: the native plants people have recorded in the garden's county or state, live from iNaturalist, wherever the garden is
- browse a starter list of 348 natives with light, water, hardiness zone and wildlife details, or search **any** plant on iNaturalist
- check, for the garden's own county and state, whether a plant is native (iNaturalist plus GBIF records) and when it flowers nearby
- **share** a read-only link so friends can walk around your garden without an account

It's plain HTML, CSS and JavaScript modules. There's no build step and nothing to install: the files in this folder *are* the website.

---

## Contents

1. [Try it on your computer](#1-try-it-on-your-computer)
2. [Put it online with GitHub Pages](#2-put-it-online-with-github-pages)
3. [Turn on Google sign-in (Firebase)](#3-turn-on-google-sign-in-firebase)
4. [Bring in an existing garden](#4-bring-in-an-existing-garden)
5. [Share a garden](#5-share-a-garden)
6. [Using the app](#6-using-the-app)
7. [How the code is organized](#7-how-the-code-is-organized)
8. [Common changes](#8-common-changes)
9. [Troubleshooting](#9-troubleshooting)
10. [Data sources, credits and privacy](#10-data-sources-credits-and-privacy)

---

## 1. Try it on your computer

Browsers won't run JavaScript modules from a `file://` address, so double-clicking `index.html` shows a blank page. Serve the folder with a tiny local web server instead.

With Python (already on most Macs and Linux machines; on Windows, install it from python.org):

```
cd path/to/native-garden
python -m http.server 8000
```

Then open **http://localhost:8000** in your browser. Press Ctrl+C in the terminal to stop the server.

(In VS Code, the "Live Server" extension does the same thing: right-click `index.html` → Open with Live Server.)

Until Firebase is set up (step 3), the app runs in **browser-only mode**: press **Start** and gardens save in that browser's storage. Everything else works the same.

## 2. Put it online with GitHub Pages

GitHub Pages hosts static sites for free. These steps use GitHub Desktop.

**Make the repository**

1. Unzip this folder somewhere you'll keep it, for example `Documents/GitHub/native-garden`.
2. In GitHub Desktop: **File → Add local repository…** and choose the folder.
3. It says the folder isn't a Git repository yet. Click **create a repository** and keep the name `native-garden`. Click **Create repository**.
4. Click **Publish repository**. Uncheck **Keep this code private**, because GitHub Pages on a free account needs a public repo. Click **Publish repository**.

**Turn on Pages**

5. On github.com, open the repo, then **Settings → Pages**.
6. Under **Build and deployment**, set **Source** to *Deploy from a branch*. Set **Branch** to `main` and the folder to `/ (root)`. Click **Save**.
7. After a minute or two, the site is live at `https://YOUR-USERNAME.github.io/native-garden/`. The Pages screen shows the link.

**Publishing changes later:** edit files, then in GitHub Desktop write a short summary, click **Commit to main**, then **Push origin**. The site updates within a minute or two.

> The repo is public, so don't commit your personal garden files. `.gitignore` already skips files named `garden*.json` and anything in a `backups/` folder.

## 3. Turn on Google sign-in (Firebase)

Firebase gives you Google sign-in and a database (Firestore) that syncs each person's gardens between devices. The free **Spark** plan allows 50,000 reads and 20,000 writes a day, far more than a group of friends will use. No credit card is needed.

The Firebase console moves things around now and then. If a menu item isn't where these steps say, use the search box at the top of the console.

**a. Create the project**

1. Go to https://console.firebase.google.com and sign in with the Google account that will own the project.
2. **Create a project** (or **Add project**). Name it, for example `native-garden`. You can turn Google Analytics off. Click through to create it.

**b. Turn on Google sign-in**

3. In the left menu, open **Authentication** (it may sit under *Build* or *Security*). Click **Get started**.
4. On the **Sign-in method** tab, choose **Google**, flip **Enable**, pick a support email, and **Save**.
5. On the **Settings** tab, open **Authorized domains** → **Add domain** and enter `YOUR-USERNAME.github.io` (no `https://`, no `/native-garden`). `localhost` is already on the list, so local testing works too.

**c. Create the database**

6. In the left menu, open **Firestore Database** (it may sit under *Build* or *Databases & Storage*). Click **Create database**.
7. If it asks for an edition, choose **Standard**. Pick a location near you (for example `nam5 (us-central)`); this can't be changed later. Choose **Start in production mode** and create it.
8. Open the **Rules** tab. Replace everything there with the contents of `firestore.rules` from this folder, then click **Publish**. These rules let each signed-in person read and write only their own data, and let anyone *read* (never change) a garden whose owner turned on its share link.

**d. Connect the app**

9. Click the gear next to **Project Overview** → **Project settings**. Under **Your apps**, click the web icon `</>`. Give it a nickname, leave "Firebase Hosting" unchecked, and **Register app**.
10. Firebase shows a `firebaseConfig` object. Copy its values into `js/config.js`, so it looks like this:

    ```js
    export const FIREBASE_CONFIG = {
        apiKey: 'AIza…',
        authDomain: 'native-garden-xxxx.firebaseapp.com',
        projectId: 'native-garden-xxxx',
        storageBucket: 'native-garden-xxxx.firebasestorage.app',
        messagingSenderId: '1234567890',
        appId: '1:1234567890:web:abc123',
    };
    ```

    These values aren't secret. A Firebase web API key only names the project; the Firestore rules are what protect the data.
11. Commit and push (step 2). Reload the site. The welcome screen now says **Sign in with Google**.

People who used the app before sign-in was on will see an offer to copy their browser-only gardens into their account the first time they sign in.

## 4. Bring in an existing garden

Any garden can be saved as a file with **Share → Download garden file**. This includes the first single-page version of this app; its `garden.json` uses an older format that imports fine.

To bring one in:

- **As a new garden:** click the garden name (top left) → **Import a garden file…**. The new garden gets the file's outline and everything in it. Set its location on the same screen.
- **Into the open garden:** **Share → Import a garden file…**. Entries with the same id are replaced; nothing else is deleted. You can choose whether to use the file's outline too.

## 5. Share a garden

Gardens saved to a Google account can be shared with a link:

1. Open the garden and click **Share** (bottom right).
2. Tick **Anyone with the link can view**, then **Copy link**, and send it to whoever you like.

The link looks like `https://YOUR-USERNAME.github.io/native-garden/?view=…`. Whoever opens it can walk around the garden, play through the months, run the sun map and Garden Check and browse the library, with no account. They can't change anything, and your edits show up for them live. They can also download a copy to import into a garden of their own.

Untick the box to turn the link off; anyone who has it then sees "This garden isn't shared right now." Gardens saved in the browser only can't be shared this way (the link reads from the cloud database); sign in and copy them into your account first, or send a downloaded file instead.

If share links don't open, make sure the **current** `firestore.rules` is published (step 3c-8): the sharing rule was added along with this feature.

## 6. Using the app

A quick tour of the parts that aren't obvious at first.

**Top bar.** Click the garden name for your garden list and settings (name, location, hardiness zone). The month strip and play button run through the year. **Growth** shows trees and shrubs some years from now, using each plant's mature size.

**Side panel tabs.**
- **Now:** what's blooming and fruiting this month, what starts next month, and this month's garden jobs.
- **Calendar:** a bloom and fruit chart for every species, or (switch at the top) **Care jobs** for the whole year.
- **Check:** Garden Check. Each finding has a Fix / Check / Idea label, links to the plants involved, and often a button that goes straight to a fix (the sun map, settings, or the library filtered to the right plants).
- **Items:** everything in the garden, searchable.
- **Library:** two views, switched at the top.
  - **Natives near you:** wild plants recorded around the garden on iNaturalist that it lists as native there, most-recorded first. It uses the garden's county, or the whole state when the county has only a few records (switch between them with the buttons). Plant-type filters work once each plant's family has been looked up, which takes a few seconds the first time; the list is then kept on the device for a week. Opening a plant runs the "For this garden" check for bloom months and county records. A plant that's also in the starter list opens its starter-list entry, with light, water and zone details.
  - **Starter list:** the 348 plants in `data/catalog.json` plus your saved plants, with filters for bloom month, native here, your hardiness zone and light.
  - Typing in the search box filters the list and also searches all of iNaturalist by name.

**Bottom-right buttons.** 3D / Plan / Eye level camera; Labels; Mature size (blue shells); Planned (show or hide plants you haven't planted yet); Wind; **Sun map**; Edit layout; Add; Share.

**Sun map.** Colors the ground by hours of direct sun on an average day of the current month: blue under 3 hours (shade), green 3–6 (part sun), yellow and orange 6+ (full sun). Shade comes from buildings, walls, fences, hedges, trees and big shrubs, at the Growth year you picked; bare winter trees let most light through. The slider moves the 3D sun through the day so you can watch shadows move. Times are "sun time": noon is when the sun is highest, which on a clock is usually 12:30–1:30.

**Edit layout.** Drag items, the garden's gold corner handles, or a freeform bed's corners. Double-click an edge to add a corner, or a corner to remove it.

**Detail panel.** Click any item. Plants show bloom and fruit months, light, water, zones and wildlife, Garden Check notes (including how many hours of summer sun that spot gets), and a "For this garden" check against iNaturalist and GBIF.

## 7. How the code is organized

```
index.html          the page skeleton (where panels go); loads js/main.js
css/app.css         all styles; colors and fonts are at the top in :root
data/catalog.json   the starter plant list
firestore.rules     database security rules (pasted into Firebase)
vendor/             three.js r170 (3D library), kept here so nothing loads from a CDN
js/
  main.js           starts everything; redraws the panels when things change
  config.js         your Firebase settings
  util.js           small helpers: building HTML, checking values, month math, fetching JSON
  model.js          what gardens and items are made of, and the clean…() checks
  state.js          shared state (S) and a tiny event bus (on / emit / scheduleUI)
  scene.js          three.js setup: renderer, camera, sky and sun, ground, camera views, wind, draw loop
  builders.js       3D models for features, structures and beds
  garden.js         keeps the 3D scene matched to the data; seasons; growth years; selection
  interact.js       clicking and dragging in the 3D view (items, outline corners, bed corners)
  sunpath.js        where the sun is in the sky for a latitude, month and hour
  sun.js            hours of sun at any spot (shade from buildings and trees) and the sun map overlay
  gardencheck.js    Garden Check: spacing, light, hardiness, water, wildlife and bloom gaps
  care.js           the care calendar: jobs for each month from what's planted
  flora/
    shapes.js       flower shapes and tree shapes, and guesses for each plant from its genus/family
    geometry.js     the 3D pieces: petals, flower heads, leaves, grass blades, stems
    textures.js     leaf images and the tileable ground textures (grass, soil, mulch, gravel, pavers…)
    wind.js         the shader tweak that makes plants sway (and their shadows with them)
    plants.js       builds each plant from those pieces; seasons; growth over the years
  store/
    index.js        the one place that loads and saves; picks a backend
    local.js        browser-only backend (localStorage)
    firebase.js     Google sign-in + Firestore backend
  library/
    catalog.js      loads data/catalog.json
    inat.js         iNaturalist API calls
    gbif.js         GBIF API calls
    location.js     "where is this garden?": GPS, place search, county lookup
    lookup.js       combines iNaturalist + GBIF into a nativity verdict and bloom months
    match.js        links garden plants to library entries (light, water, zones, wildlife)
    nearby.js       "Natives near you": native plants recorded around the garden (iNaturalist)
  ui/
    gardens.js      home screen: welcome, sign-in, garden list, new garden, settings
    months.js       the month strip and play button
    panes.js        Now, Calendar (bloom chart and care jobs) and Items tabs
    gardencheck.js  the Check tab, and Garden Check notes in a plant's details
    library.js      Library tab (Natives near you and the starter list) and library entries
    lookup.js       the "For this garden" box
    detail.js       the right-hand panel: item details and the Add/Edit form
    sunpanel.js     the Sun map button, color key and time-of-day slider
    toolbar.js      bottom-right buttons, Share menu, keyboard shortcuts
    common.js       small shared UI pieces
```

Every file starts with a comment explaining what it does and how it connects to the rest.

### The big idea: data → scene and panels

There's one source of truth, the `S` object in `state.js`. `S.items` holds Maps of plants, features and zones. When data changes:

1. `garden.js` (`upsertItem` / `removeItem`) updates `S.items` and rebuilds that item's 3D model.
2. It calls `scheduleUI()`, which on the next animation frame emits `'ui'`.
3. `main.js` hears `'ui'` and calls `renderAllUI()`, which redraws whichever panels are showing from `S`.

The panels never keep their own copy of the data; they just redraw from `S`. That keeps things simple: if a panel looks wrong, check `S`.

### Follow a click: adding a plant from the Library

1. `ui/library.js` → `renderLibrary()` draws a row; clicking it calls `openLib('cat:little-bluestem')`, which sets `S.libSel`.
2. `ui/detail.js` → `renderDetail()` sees `S.libSel` and asks `renderLibDetail()` to fill the right panel.
3. **Add to garden** → `addToGarden()` sets `S.form = { mode: 'new', kind: 'plants', prefill }`.
4. `renderDetail()` now draws the form (`renderForm()`), filled in from `prefill`.
5. Submitting runs `submitForm()`: it reads the fields, cleans them with `cleanPlant()` (`model.js`), shows the plant with `upsertItem()`, and saves it with `Store.saveItem()`.
6. `store/index.js` hands it to the backend. With Firebase, Firestore saves it and then sends the new list back through `watchItems`, which calls `syncItems()`. That sees nothing new and does nothing.

### Follow a drag

`interact.js` listens for pointer events on the 3D canvas. In Edit layout, `pointerdown` raycasts (shoots a line from the camera through the pointer) to find which item was hit, moves it with the pointer while dragging, and on `pointerup` calls `Store.saveItem()`.

### Saving: two backends, one interface

`store/local.js` and `store/firebase.js` have the same functions (`watchGardens`, `saveGarden`, `watchItems`, `saveItem`, …). `store/index.js` picks one and the rest of the app never knows which. In Firestore, everything lives under `users/{uid}/…`; see the top of `store/firebase.js` for the layout.

A share link (`?view=owner/garden`) runs the app in a third mode, `'view'`: `main.js` spots it and calls `Store.openShared()`, which watches that one garden through Firebase without signing in. `S.readOnly` is true, so the save functions in `store/index.js` do nothing, and the UI hides Edit layout, Add and the Edit/Delete buttons.

### How a plant is drawn

`flora/plants.js` → `buildPlant(item)` picks a builder by growth form (wildflower patch, grass, tree, shrub, vine, iris, cactus). Each builder scatters stems, leaves and flower heads with a random generator seeded from the plant's id, so a plant looks the same every time. The pieces come from `flora/geometry.js`, and the flower head's shape comes from the plant's **Flower shape** setting, or a guess from its genus or family (`flora/shapes.js`). Thousands of copies of each piece go into one `InstancedMesh`, which draws them all at once, so even big gardens stay fast. `seasonPlant()` then shows the right parts for the month: buds, flowers, seed heads, fall color, bare branches.

### How the sun map works

`sun.js` turns buildings, walls, hedges and fences into boxes and tree and shrub canopies into egg shapes. For each spot on a grid, it steps through an average day in half-hour steps (`sunpath.js` gives the sun's direction) and checks whether a straight line toward the sun hits any of those shapes. Hours in the sun are added up and colored. Garden Check uses the same code to measure each plant's spot in July (January south of the equator).

## 8. Common changes

**Colors and fonts.** Edit the variables in `:root` at the top of `css/app.css`.

**Add plants to the starter list.** Open `data/catalog.json`, copy an entry, give it a new unique `id`, and edit it. The fields are described above `cleanLib()` in `js/model.js`. Months are numbers 1–12. `sun` lists the light it's happy in (`full`, `part`, `shade`); `water` is `dry`, `medium` or `moist`; `zones` is the USDA hardiness range like `[4, 9]`; `tags` lists wildlife it supports (`bees`, `butterflies`, `host`, `hummingbirds`, `birds`); `regions` lists the US regions it's native to (see `REGIONS` in `model.js`). `native` is one of `county`, `adjacent`, `region`, `state`, `no`, `unknown`. Those codes are relative to Roger Mills County, OK; see `catalogNative()` in `model.js` for how they're translated for gardens elsewhere.

**Add a new kind of feature** (say, a bat house):
1. In `js/model.js`, add `bathouse: 'Bat house'` to `FTYPES`.
2. In `js/builders.js`, add a `case 'bathouse': { … }` to `buildFeature()`. Copy the `nestbox` case as a starting point. `addMesh(group, shape, material, [x, y, z], [width, height, depth])` places a box or cylinder; set `top` (label height) and `foot` (selection ring size).
3. Reload. It appears in the Add form's "Kind" list.
4. If it should cast shade on the sun map, add it to `BOXES` in `js/sun.js`.

**Change how a plant looks.** Easiest first: in the plant's Edit form, set **Flower shape (3D)**, **Flower size** or **Tree / shrub shape**. To change what a whole genus gets by default, edit `GENUS_FLOWER`, `GENUS_SIZE` or `GENUS_CROWN` in `js/flora/shapes.js`. To change how a growth form is built, see the `build…()` functions in `js/flora/plants.js`; `FLOWER_BOOST` and `STEM_BOOST` near the top make flowers and stems bigger or smaller everywhere (real sizes look tiny from across a garden). Seasonal changes are in `seasonPlant()` in the same file.

**Speed versus detail.** `QUALITY` near the top of `js/scene.js`: `density` (how many stems, leaves and flowers; 1 = full), shadow map size and pixel ratio. Phones and computers with 4 or fewer processor cores get the `low` settings automatically.

**Garden Check thresholds.** In `js/gardencheck.js`: `checkSpacing()` (how much overlap counts as crowding), `checkLight()` (and `sunLevel()` in `js/sun.js` for the 3 / 6 hour lines), `checkHardiness()`.

**Add a care job.** Each rule in `buildJobs()` in `js/care.js` is a few lines: pick the plants, then `add(month, { tag, ids, title, text })`. The comment at the top explains months for southern gardens.

**Sun map colors.** `RAMP` in `js/sun.js` and `KEY` in `js/ui/sunpanel.js` (keep them matching).

**Change the default size of new gardens.** `newView()` in `js/ui/gardens.js` (the `60` and `40`).

**Change what counts as a "thin month".** `isThin()` in `js/ui/common.js`.

**Change how nativity is decided.** `verdict()` in `js/library/lookup.js`.

**Debugging tips.** Open the browser's developer tools (F12) → Console. Because these are ES modules, you can inspect the live app from the console:

```js
const { S } = await import('./js/state.js');
S.items.plants          // every plant
S.meta                  // the open garden's settings
```

## 9. Troubleshooting

| What you see | What to do |
|---|---|
| Blank page when opening `index.html` directly | Use a local server (step 1) or the GitHub Pages address. |
| Sign-in says the domain isn't authorized | Add `YOUR-USERNAME.github.io` under Authentication → Settings → Authorized domains. |
| Sign-in popup doesn't appear | Allow popups for the site. The app falls back to a full-page redirect if the popup is blocked. |
| "The database refused that" | The Firestore rules weren't published. Redo step 3c-8. |
| "Google sign-in is turned off in Firebase" | Enable Google under Authentication → Sign-in method. |
| Library search or the "For this garden" check says it can't connect | iNaturalist or GBIF is unreachable (offline, or the service is down). The rest of the app keeps working. |
| Changes made offline | With sign-in, they're kept on the device and upload when you're back online (the chip says *Offline · changes upload later*). |
| Browser-only gardens disappeared | They live in that browser's storage, so clearing site data deletes them. Sign in, or download backups from Share. |
| The 3D view is slow or choppy | Turn off **Wind**, hide **Labels**, or lower `density` in `QUALITY` (`js/scene.js`). Very large gardens with hundreds of trees are the heaviest. |
| A share link says the garden isn't shared | The owner needs **Share → Anyone with the link can view** ticked, and the current `firestore.rules` published. |
| The sun map is all one color | Nothing tall enough to cast shade is in the garden yet, or the month is midsummer with a high sun. Add buildings, fences or trees, or try December. |

## 10. Data sources, credits and privacy

- **iNaturalist** (https://www.inaturalist.org): plant search, the "Natives near you" list (species recorded in a place and listed as native there), photos, Wikipedia summaries, native/introduced status, and flowering observations. Photos belong to their photographers and are shown with the credit and license iNaturalist provides. The API is free and asks apps to stay under about 60 requests a minute; the app only calls it when you search, open a plant or load "Natives near you" (one request per 200 plants, plus one per 30 plants for families, a second apart), and caches answers.
- **GBIF** (https://www.gbif.org): occurrence records used to count how often a plant has been recorded in your county and state, plus the county lookup for new gardens.
- **OpenStreetMap Nominatim** (https://nominatim.openstreetmap.org): place search when creating a garden. Searches run only when you press Search, as their usage policy requires. © OpenStreetMap contributors.
- **three.js** (https://threejs.org): the 3D library, MIT license, in `vendor/`.
- **Fonts:** Barlow Condensed and IBM Plex, from Google Fonts (SIL Open Font License).
- **Starter list:** 348 natives. The first 98 were researched for Roger Mills County, Oklahoma; bloom and fruit months are typical for that area. The rest are common natives from across the US with typical sizes, bloom times and growing needs from general references, compiled with AI assistance and not individually verified. Use "Check for this garden" to see how a plant does near you.
- **Care calendar and Garden Check** give general guidance for low-maintenance, wildlife-friendly native gardens. Local conditions vary; your extension office or native plant society knows your area best.

**What's stored.** For each garden: its name, outline and items, plus a location rounded to about 1 km (latitude/longitude, county, state). With sign-in, that's in your Firebase project under the person's Google user id, readable only by them, unless they turn on a share link for a garden: then anyone with that link can read that garden (including its county and rounded location) until they turn it off. Without sign-in, it stays in that browser. Nothing is sent anywhere else, except plant and place lookups to the services above.
