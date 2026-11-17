# What’s New release controls

The app reads two Statsig controls:

| Control | Type | Purpose |
| --- | --- | --- |
| `show_whats_new` | Feature gate | Enables the automatic prompt for the targeted users. Default: off. |
| `whats_new` | Dynamic config | Provides the release version, heading, and highlights. |

The feature gate
starts with no passing rules. The
dynamic config
contains the 1.1.6 notes below. Keeping the gate off allows manual visits without
automatic prompts. An empty `{}` config also prevents automatic prompts.

For a release you want to announce, update this config with that release’s
actual version and user-facing highlights:

```json
{
  "release": {
    "version": "1.1.6",
    "title": "More ways to feel at home",
    "description": "A fresh look and a few thoughtful updates for your week.",
    "highlights": [
      {
        "icon": "compass",
        "title": "A fresh look, made for you",
        "description": "Explore your church with refreshed screens, simpler navigation, and light and dark themes."
      },
      {
        "icon": "church",
        "title": "Your campus, closer",
        "description": "Choose your campus in Profile to find its events, livestreams, and giving in one place."
      },
      {
        "icon": "bookmark",
        "title": "Keep the words that speak to you",
        "description": "Save verses and your personal words of activation to return to throughout the week."
      }
    ]
  }
}
```

## Announcing a release

1. Prepare the config for the release you want to announce. Its version is
   explicit and independent of `apps/mobile/native-version.js`.
2. Enable `show_whats_new` for the intended audience and environment when ready.
   Use a development-only rule for testing before a production rollout.
3. Turn the gate off to stop automatic prompts. Keep the release details
   available for users visiting More → Connect & Resources → App → What’s New.

The app requires online connectivity, a passing gate, and valid configured
notes. It waits until Home is active and no update prompt is required.
Missing or malformed config,
an unavailable native version, and notes for a newer binary never trigger it.
Versions use `major.minor.patch`; every text field must be nonblank, and at least
one highlight is required. Icons use Font Awesome 6 solid/regular names; unknown
names render the gift icon.

Each configured release version is acknowledged once per installation. Editing
its wording, toggling the gate off and back on, changing the build number, or
shipping a later app version does not reannounce an already-viewed release.
Fresh installations start with their installed version acknowledged; sign-out
does not erase this acknowledgment. Users who skip releases see the configured
announcement if it is newer than their acknowledgment and available in their
installed binary.

Offline or unknown connectivity prevents automatic prompts even when Statsig
has cached an enabled gate and release details. Losing connectivity during the
presentation delay cancels the prompt without acknowledging the release; it
can appear once the device reconnects and remains eligible. Manual visits can
still display cached details or the explicitly versioned bundled notes.
Bundled fallback content never enables the automatic prompt.
