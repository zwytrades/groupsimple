# groupsimple — fresh start setup

This folder is a clean, unconnected starting point. It contains the website and Worker code, but **no prefilled Worker URL, Discord invite, previous server listings, account IDs, tokens, or linked repository**. The directory starts empty. Nothing in this package can control an existing Discord server or Cloudflare Worker unless you deliberately configure it to use those resources.

You can use your existing personal GitHub and Cloudflare logins while creating new project resources. To keep the Discord side separate too, create a brand-new Discord server and a brand-new Discord application/bot specifically for groupsimple.

## Before you begin

Keep this folder as your clean master copy. Do not reuse your old repository, existing groupsimple Worker name, old Discord application, old bot, or old server ID. The instructions below create new resources. Do not paste any secret into `config.js`, `index.html`, or a public GitHub repository.

## 1. Create a brand-new GitHub repository

1. Open https://github.com/ and sign in.
2. Click **+ → New repository**.
3. Choose a new name, for example `groupsimple-fresh-start`. Make it **Public** if you are using GitHub Free for Pages.
4. Create the repository. Do not select an old groupsimple repository.
5. Download and install GitHub Desktop from https://desktop.github.com/ if you do not already use it.
6. In GitHub Desktop, clone the new `groupsimple-fresh-start` repository to your computer.
7. Copy the **contents** of this package folder into the cloned repository folder. Make sure `index.html` is at the repository root, not in a nested folder.
8. In GitHub Desktop, commit with a message such as `Initial fresh groupsimple site`, then click **Push origin**.
9. On GitHub.com, open the new repository → **Settings → Pages**. Under Build and deployment choose **Deploy from a branch**, select branch `main` and folder `/(root)`, then save.
10. Wait for GitHub Pages to publish. The URL will look like `https://YOUR-GITHUB-USERNAME.github.io/groupsimple-fresh-start/`. Copy the exact URL. This is your `SITE_URL`.
11. Your `ALLOWED_ORIGIN` is only the website origin, for example `https://YOUR-GITHUB-USERNAME.github.io` — do not add the repository path to the origin.

Official guide: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## 2. Create a brand-new Discord server and app

### Create the server

1. In Discord, use **Add a Server → Create My Own** and create a fresh server for groupsimple.
2. Create a private text channel named `listing-requests`. Only you, your moderators, and the bot should be able to see it.
3. Open Discord **User Settings → Advanced** and turn on **Developer Mode**.
4. Right-click the new server name/icon and choose **Copy Server ID**. Save it as `DISCORD_GUILD_ID`.
5. Right-click `#listing-requests` and choose **Copy Channel ID**. Save it as `DISCORD_CHANNEL_ID`.
6. If you want `/post` to have a default public channel, create that channel and copy its ID for optional `DISCORD_LISTINGS_CHANNEL_ID`.

### Create the Discord application and bot

1. Go to https://discord.com/developers/applications and click **New Application**. Give it a new name, such as `groupsimple-fresh-start`.
2. In **General Information**, copy **Application ID** (`DISCORD_APP_ID`) and **Public Key** (`DISCORD_PUBLIC_KEY`).
3. In **OAuth2**, generate/copy the **Client Secret** (`DISCORD_CLIENT_SECRET`). Keep it secret.
4. Open **Bot** and create the bot user if prompted. Generate/reset the bot token and copy it as `DISCORD_BOT_TOKEN`. Never share it.
5. Leave the OAuth redirect blank for the moment; you will add the actual Worker callback URL in Step 5.
6. Under the app's installation settings or OAuth2 URL Generator, select scopes `bot` and `applications.commands` for the server installation.
7. Give the bot these permissions: **View Channels**, **Send Messages**, **Embed Links**, **Attach Files**, and **Read Message History**.
8. Use the generated installation link to add this new bot to your new groupsimple server.
9. In the new `#listing-requests` channel's permissions, explicitly allow the new bot to view the channel, send messages, embed links, attach files, and read message history.

Official guide: https://discord.com/developers/docs/quick-start/getting-started

## 3. Create a GitHub token only for the new repository

1. Open https://github.com/settings/personal-access-tokens.
2. Create a **Fine-grained token** with repository access limited to your new `groupsimple-fresh-start` repository.
3. Give it **Contents: Read and write** permission.
4. Generate the token and copy it to your private notes as `GITHUB_TOKEN`.
5. Do not commit this token to GitHub or put it in website code.

## 4. Create a brand-new Cloudflare Worker

1. Open https://dash.cloudflare.com/ and go to **Workers & Pages**.
2. Choose **Create** and create a new Worker named `groupsimple-fresh-start` (or another new name). Do not open or edit a Worker from a previous project.
3. Deploy the starter Worker if the dashboard asks you to.
4. Open the new Worker's code editor. Open this package's `worker/worker.js` in a text editor, copy the entire file, paste it over the starter code, then deploy.
5. Copy the **new Worker URL** shown by Cloudflare, for example `https://groupsimple-fresh-start.YOUR-SUBDOMAIN.workers.dev`. This is the URL you will use in the Discord callback and `config.js`.

### Configure variables and secrets on this new Worker

Open the new Worker → **Settings → Variables and Secrets**. Add the following values to this new Worker only:

| Name | Value | Store as |
|---|---|---|
| `DISCORD_PUBLIC_KEY` | Public Key from Step 2 | Secret or variable |
| `DISCORD_APP_ID` | Application ID from Step 2 | Variable |
| `DISCORD_CLIENT_SECRET` | Client Secret from Step 2 | Secret |
| `DISCORD_BOT_TOKEN` | New bot token from Step 2 | Secret |
| `DISCORD_CHANNEL_ID` | New private moderator channel ID | Variable |
| `DISCORD_GUILD_ID` | New groupsimple Discord server ID | Variable |
| `DISCORD_LISTINGS_CHANNEL_ID` | Optional default public posting channel ID | Variable |
| `GITHUB_TOKEN` | Token restricted to the new repository | Secret |
| `GITHUB_REPO` | `YOUR-GITHUB-USERNAME/groupsimple-fresh-start` | Variable |
| `GITHUB_BRANCH` | `main` | Variable |
| `SITE_URL` | Full GitHub Pages URL including repo path and ending `/` | Variable |
| `ALLOWED_ORIGIN` | Site origin only, without the repo path | Variable |
| `SESSION_SECRET` | A new random secret at least 32 characters long | Secret |
| `SETUP_KEY` | A different new random setup key | Secret |
| `ADMIN_USER_IDS` | Optional comma-separated moderator user IDs | Variable |

Use a password manager to generate new random `SESSION_SECRET` and `SETUP_KEY` values. Do not reuse any secret from an old project. In Cloudflare, mark access tokens, the Discord Client Secret, bot token, session secret, and setup key as **Secret**. Secrets should not be stored in Wrangler config or checked into GitHub.

Official guide: https://developers.cloudflare.com/workers/configuration/secrets/

## 5. Connect only the new Discord app to the new Worker

1. In the new Discord application, open **OAuth2** and add this Redirect URI, replacing the example with your new Worker URL:
   `https://YOUR-NEW-WORKER.workers.dev/auth/callback`
2. Save the redirect exactly as written. It must match the callback URL used by the Worker.
3. In the same Discord application, open **General Information** and set **Interactions Endpoint URL** to:
   `https://YOUR-NEW-WORKER.workers.dev/interactions`
4. Save. Discord should validate the endpoint if the Worker and Public Key are configured correctly.
5. Register the slash commands by opening this URL once in your browser (replace both placeholders):
   `https://YOUR-NEW-WORKER.workers.dev/register-commands?key=YOUR_NEW_SETUP_KEY`
6. Confirm the response reports successful command registration. Keep the setup URL private. After registering the commands, you can delete `SETUP_KEY` from Worker settings if you do not need to register again. If you need it later, add a new setup key first.

## 6. Connect the fresh website to the fresh Worker

Only after Steps 1 and 4 are complete, edit `config.js` in your **new GitHub repository** and fill in your new URLs:

```js
window.GS_CONFIG = {
  workerUrl: "https://YOUR-NEW-WORKER.workers.dev",
  discordInvite: "https://discord.gg/YOUR_NEW_SERVER_INVITE"
};
```

- Use your **new Worker URL**, without a trailing slash.
- Use an invite to your **new groupsimple Discord server**.
- Do not reuse a Worker URL or Discord invite from a previous project.
- Commit and push the change. Wait for GitHub Pages to publish.

## 7. Verify the fresh deployment

1. Open `https://YOUR-NEW-WORKER.workers.dev/health`. A healthy response should contain `"ok":true`.
2. Open the new Pages URL. The directory should be empty because `groups.json` starts with `{"groups":[]}`.
3. Click **Join Discord**; it should open the new server invite.
4. Click **Login with Discord** and authorize the new app. It should return you to the new site.
5. Submit a test listing. It should appear in the new private `#listing-requests` channel.
6. Click **Approve** in that channel. Wait for the new repository's Pages site to update and confirm the listing appears.
7. Test `/groups`, `/add`, `/remove`, `/boost`, `/unboost`, and `/post` in your new server. Management commands require **Manage Server** permission or an ID in `ADMIN_USER_IDS`.

## What this fresh package does not do

- It does not delete or change any old GitHub repository, Cloudflare Worker, Discord application, bot, or server.
- It does not connect to a previously deployed Worker; the `workerUrl` setting is intentionally blank.
- It does not include the previously listed sample/test groups; `groups.json` is empty.
- It does not include any credentials or secret values.
- It does not connect to an existing Discord server until you intentionally supply your new app/server IDs and new invite.

If you want to stop an old deployment completely, do that separately in the old service: remove its bot from the old server and/or delete its old Worker after confirming it is no longer needed. Do not delete anything old just to deploy this fresh version; this package can run independently.

## Troubleshooting

- **Login does not work:** check the new Worker's `DISCORD_APP_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, `SITE_URL`, and the exact `/auth/callback` Redirect URI.
- **Discord rejects the Interactions Endpoint URL:** check that the new Worker is deployed and that `DISCORD_PUBLIC_KEY` matches the new application's Public Key.
- **Listing submission fails:** check the new origin in `ALLOWED_ORIGIN`, bot access to the new moderator channel, and GitHub token permissions/repository name.
- **Slash commands do not appear:** confirm the new bot is installed into the new server and run the command registration URL with the new `SETUP_KEY`.
- **A listing is approved but does not appear immediately:** wait for GitHub Pages to redeploy, then reload the site.
