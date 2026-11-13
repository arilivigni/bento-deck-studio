---
title: Release process
description: How bento-deck-studio versions, tests, tags, publishes, and rolls back plugin releases and the project website.
order: 7
---

# Release process

This plan covers the first release, **v1.0.0**, and every release after it. The plugin and its project website ship from the same repository, `arilivigni/bento-deck-studio`.

## Release scope for v1.0.0

| Area | Included |
| --- | --- |
| Plugin | The `bento-deck-studio` agent, six Agent Skills, and the dependency-free scripts. |
| Distribution | The repository marketplace (`.github/plugin/marketplace.json`), a pinnable `v1.0.0` tag, and a GitHub release with a plugin zip. |
| Integrity | `SHA256SUMS` and a build provenance attestation for the zip. |
| Website | <https://arilivigni.github.io/bento-deck-studio/>, deployed from `main` by GitHub Actions. |
| Docs | README, website docs, `CHANGELOG.md`, and this plan. |

Out of scope for v1.0.0: listing in other marketplaces such as `github/awesome-copilot`, an npm package, and Windows-calibrated typography.

## Versioning

The plugin follows [Semantic Versioning](https://semver.org/). The version lives in three places and must match: `plugin.json`, and the `metadata.version` and plugin entry `version` in `.github/plugin/marketplace.json`. Tags are `v` plus the version, for example `v1.0.0`.

The public contract is:

- agent and skill names, and what each skill is for;
- script names, options, and exit behavior;
- the Markdown outline format, including `<!-- layout: -->` and `<!-- notes: -->` hints;
- the `theme.json` `schemaVersion`;
- the site contract: the `slides/deck.bento.html` path, read-only public decks, and **Slides ↗** first in full sites.

| Change | Version bump |
| --- | --- |
| Removes or renames any part of the contract, or changes its meaning | **Major** |
| Adds a skill, option, layout hint, or site feature in a compatible way | **Minor** |
| Fixes bugs, improves fidelity, or updates docs without contract changes | **Patch** |

## Channels

| Channel | How users get it | Stability |
| --- | --- | --- |
| Pinned release | `copilot plugin marketplace add arilivigni/bento-deck-studio#v1.0.0` | Fixed; recommended for workshops and teams. |
| Latest | `copilot plugin marketplace add arilivigni/bento-deck-studio` | Tracks `main`; always passes CI. |
| Offline | The zip on the GitHub release, verified with `SHA256SUMS` and `gh attestation verify`. | Fixed. |

`main` is always releasable: every change must pass the **Plugin CI** workflow before it merges.

## Quality gates

A release cannot be tagged until all of these pass.

**Automated** (Plugin CI and the release workflow):

- [ ] `node --test` passes.
- [ ] `node scripts/validate.mjs .` passes for plugin manifests and every skill.
- [ ] `node scripts/release.mjs check <version>` passes: versions match, `CHANGELOG.md` has a dated section for the version, and the tag does not already exist.
- [ ] `node scripts/website-build.mjs --out _site` succeeds with no broken internal links, and `node scripts/validate.mjs _site --site` passes.

**Manual** (record the results in the release pull request or issue):

- [ ] Build a deck from a real brand template and compare every slide with the source in PowerPoint.
- [ ] Open the showcase deck and every website page at desktop and mobile widths, and confirm **Slides ↗** opens the deck in a new tab.
- [ ] Install the plugin into a clean Copilot home from the release candidate ref, then confirm the agent and all six skills load.
- [ ] Review the release notes for accuracy.

## Release procedure

1. **Prepare.** Move the `[Unreleased]` entries in `CHANGELOG.md` into a new `## [x.y.z] - YYYY-MM-DD` section, and update the comparison links.
2. **Bump.** Run `node scripts/release.mjs bump x.y.z` to update all three version fields.
3. **Check.** Run `node scripts/release.mjs check x.y.z`, then the automated gates above. Complete the manual gates.
4. **Merge.** Commit as `Release vx.y.z` and merge to `main`. The **Deploy website** workflow publishes the site with the new version.
5. **Tag.** On the release commit, run `git tag -a vx.y.z -m "vx.y.z"` and `git push origin vx.y.z`.
6. **Publish.** The **Release** workflow:
   - re-runs the tests and validation;
   - checks that the tag matches the manifest version;
   - packages `bento-deck-studio-x.y.z.zip` with `git archive` (website and media sources are excluded through `.gitattributes`);
   - writes `SHA256SUMS`, attests build provenance, and creates the GitHub release with notes from `CHANGELOG.md`.
7. **Verify.** Run the post-release checks below.
8. **Announce.** Share the release link and the pinned install command.

## Website deployment

The **Deploy website** workflow (`.github/workflows/pages.yml`) runs on every push to `main` that touches the website, docs, skills, manifests, or changelog, and on demand. It builds the site with `scripts/website-build.mjs`, validates it, and deploys it with the GitHub Pages actions. The Pages source is **GitHub Actions**.

The showcase deck in `website/slides/deck.bento.html` is a reviewed build artifact. Its source is `website/deck/showcase.md`. To refresh it, rebuild with `deck-build` from the brand template, review every slide, and replace the file. CI does not rebuild it, because the template is not stored in the repository.

## Post-release checks

- [ ] The GitHub release lists the zip and `SHA256SUMS`, and `shasum -a 256 -c SHA256SUMS` passes.
- [ ] `gh attestation verify bento-deck-studio-x.y.z.zip --repo arilivigni/bento-deck-studio` passes.
- [ ] A clean install from `arilivigni/bento-deck-studio#vx.y.z` lists the agent and six skills.
- [ ] The website shows the new version, and its Releases page lists the release.

## Rollback

Releases are immutable; fix forward when possible.

- **Bad plugin release:** mark the GitHub release as a pre-release or add a warning to its notes, then ship a patch release. Do not move or delete a published tag, because users may have pinned it. Tell affected users to pin the last good tag.
- **Bad website deploy:** revert the commit on `main`, or re-run **Deploy website** from the last good commit. The site is static, so a redeploy fully restores it.
- **Compromised release asset:** delete the asset, publish a security advisory, and release a patch with new checksums and attestations.

## Roadmap

These ideas are candidates, not commitments:

- Charts and tables converted from layouts into native bento content.
- Windows typography calibration.
- More starter outlines and example templates.
- A listing in a public Copilot plugin marketplace.
