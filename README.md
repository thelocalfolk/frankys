# Franky's — Shopify theme (Stretch 2.1.0, "rebrand v2")

Source for the frankys.com.au theme. Maintained by The Local Folk.

## Branches

| Branch | What it is | Connected to |
|---|---|---|
| `main` | Snapshot of the **live** theme as exported 28 Sep 2026, 8:15pm. Only merge into it once changes are approved and deployed. | Nothing (not connected) |
| `dev` | Working branch — all new code goes here. | Unpublished **"Franky's – Dev"** theme in Shopify (Themes → Add theme → Connect from GitHub) |

## Rules

- **Never connect the published/live theme to this repo.** Test in the dev theme, preview, then deploy deliberately.
- The Shopify GitHub integration syncs both ways: pushes to `dev` update the dev theme, and theme-editor changes in the dev theme are committed back to `dev` by Shopify. Pull before you start work.
- `config/settings_data.json` and `templates/*.json` hold theme-editor content. Merchants edit the **live** theme editor directly, so before deploying, re-export live settings and reconcile so their changes aren't overwritten.
- Feature work: branch off `dev` (e.g. `feature/build-your-setting`), merge back into `dev` to preview.
