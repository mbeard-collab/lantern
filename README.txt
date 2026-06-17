DASHBOARDS SITE — quick reference

NOTE: This site now auto-deploys from github.com/mbeard-collab/lantern on each push to main.

This folder is the entire website. Drag the folder onto Netlify to deploy.

STRUCTURE
---------
index.html                  → landing page (the hub)
<dashboard-name>/index.html → each dashboard lives in its own folder

UPDATING A DASHBOARD
--------------------
1. Replace the file at <dashboard-name>/index.html with the new HTML.
2. Drag the entire dashboards-site folder onto your Netlify site's "Deploys" tab.
3. The new version is live in about 30 seconds.

ADDING A NEW DASHBOARD
----------------------
1. Make a new folder here (e.g. "forecasting/").
2. Put the dashboard HTML inside as index.html.
3. Open index.html (the landing page) and add an entry to the DASHBOARDS array
   near the bottom of the file:
       { id: "forecasting", title: "Forecasting", description: "...",
         section: "operational", href: "/forecasting/", owner: "...",
         cadence: "weekly", updated: "today" }
4. Drag the dashboards-site folder onto Netlify.

DASHBOARDS WITH A SEPARATE DATA FILE
------------------------------------
A dashboard's HTML can reference a sibling data file (e.g. it does
`fetch('./data.json')`). Because the whole folder is served over HTTP, put
both files in the dashboard's folder and use a RELATIVE path:
    <dashboard-name>/index.html
    <dashboard-name>/data.json   ← referenced as ./data.json from the HTML
(Opening the HTML directly from disk fails on this — the browser blocks
file:// fetches. Serving it from the site, as here, is what makes it work.)

Via Studio: in the "Upload existing HTML" mode there's now a "Data files"
field — attach the .json/.csv the HTML references and Studio commits them
into the dashboard folder next to index.html. Studio also warns if the HTML
references a data file you haven't attached.

REMOVING A DASHBOARD
--------------------
1. Delete the folder.
2. Remove its entry from the DASHBOARDS array in index.html.
3. Re-deploy.

NOTES
-----
- Netlify replaces the whole site on each drag-and-drop deploy.
  Always drag the FULL dashboards-site folder, never individual files.
- Password protection is set in Netlify, not here.
- The "Updated X days ago" field in index.html is hand-edited for now.
