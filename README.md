# groupsimple fresh start

This bundle is intentionally unconnected: `config.js` has no Worker URL or Discord invite, `groups.json` has no listings, and `wrangler.toml` uses a new Worker name so a deploy won't target the previously named Worker.

1. Follow `SETUP.md` from top to bottom.
2. Create a new GitHub repository, a new Discord application/bot, and a new Cloudflare Worker.
3. Only put fresh project URLs and IDs into configuration after those resources exist.
4. Put credentials in Cloudflare Worker Secrets, never in website files.

The package does not modify or remove old resources in your accounts.
