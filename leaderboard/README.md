# Class leaderboard (Google Sheet)

Players type a name at the end of their run and see the class top 5. A projector view
shows the live board with a QR code to the game. Scores are stored in a Google Sheet you
own, through the small script in `Code.gs`. Without this setup the game works as before,
just without the leaderboard.

## Set it up (about 5 minutes)

1. Go to https://sheets.new and give the sheet a name, for example "Nazare scores".
2. In the sheet open **Extensions > Apps Script**. Delete the sample code, paste in the
   whole of `Code.gs` and press **Save** (the disk icon).
3. Click **Deploy > New deployment**. Click the gear next to "Select type" and choose
   **Web app**. Set:
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click **Deploy**.
4. Google asks you to authorise the script. Pick your account. If you get a screen
   saying "Google hasn't verified this app", click **Advanced**, then
   **Go to ... (unsafe)**, then **Allow**. This is your own script, and all it can access
   is this one spreadsheet.
5. Copy the **Web app URL** (it ends in `/exec`).
6. Paste it into `web/js/leaderboard.js`:

   ```js
   export const LEADERBOARD_URL = "https://script.google.com/macros/s/.../exec";
   ```

7. Commit and push. GitHub Pages republishes the game within a minute or two.

To test it, open the URL from step 5 in a browser. You should see something like
`{"ok":true,"day":"2026-11-04","players":0,"top":[]}`.

## Using it in class

- **Projector:** open the game link with `?board` added, for example
  `https://YOUR-NAME.github.io/nazare/?board`. It refreshes every 5 seconds and
  briefly highlights new scores. Players can scan the QR code on it to open the game.
  `?board=all` shows the all-time board instead of today's.
- **Players:** after the third wave they type a name and press **Post score**. The board
  keeps each name's best score, so playing again only counts if it beats the old one.
- **Today only:** the board only counts scores from today (in the time zone set under
  Apps Script **Project Settings**). Each class starts fresh, and old scores stay in the
  sheet.
- **Removing an entry:** delete its row in the "Scores" tab, including test runs from
  before class. The board updates on its next refresh.

## Limits

- Saving takes 1 to 3 seconds. If many players post at the same moment, the game
  retries automatically.
- Names are limited to 16 characters, and scores above 500,000 are rejected. Someone
  with browser developer tools could still post a made-up score below that, so delete
  anything that looks off.
- If you change `Code.gs` later, use **Deploy > Manage deployments**, edit the existing
  deployment and pick **New version**. That keeps the same URL. A "New deployment"
  would give you a new URL, which you'd then have to paste into the game again.
