# Security policy

## Supported versions

Security fixes go into the latest release. Pin a release tag, such as `arilivigni/bento-deck-studio#v1.0.0`, and update to the newest patch when one ships.

| Version | Supported |
| --- | --- |
| 1.x | Yes |

## Reporting a vulnerability

Please report security issues privately through [GitHub private vulnerability reporting](https://github.com/arilivigni/bento-deck-studio/security/advisories/new). Do not open a public issue.

Include the affected version, steps to reproduce, and the impact. Confirmed issues are fixed in a patch release and disclosed in a GitHub security advisory.

## Verifying releases

Each release zip is built by GitHub Actions from its tag and ships with `SHA256SUMS` and a build provenance attestation:

```sh
shasum -a 256 -c SHA256SUMS
gh attestation verify bento-deck-studio-1.0.0.zip --repo arilivigni/bento-deck-studio
```
