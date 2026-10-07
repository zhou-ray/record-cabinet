# Public demo and invited Spotify beta

## Shareable demo

Use https://record-cabinet-livid.vercel.app/?demo=1 for public usability testing. This explicitly opens the demo without replacing a saved library. Local synthesized audio requires no Spotify authorization. The expanded demo contains 60 fictional sleeves, with extra sleeves reusing the 15 original audio sketches. Open All records to try the divider tabs. Larger synthetic fixtures cover performance separately.

Start with 10–20 people across desktop and mobile. Ask them to choose and play a record, return the sleeve, browse another bin, and organize records. Avoid explaining the gestures first: observe where the interaction needs explanation. Ask what felt satisfying, confusing, or slow. Do not claim a real Spotify streaming test from demo results.

## Feedback

Library & settings → Report a problem includes the app version. Browser/playback diagnostics are optional and exclude library contents, account identifiers, and credentials. Reports stay local until the tester chooses to share them. User-written text still needs review before public posting. GitHub's bug-report template asks for expected behavior, reproduction steps, device, and an optional report.

## Invited group

Use the Spotify developer dashboard to manage the app's authorized users within the applicable limit. Test real imports, playback, account separation, sync, unavailable tracks, and interrupted connections on physical devices. Current provider rules: https://developer.spotify.com/documentation/web-api/concepts/quota-modes

## Browser checks

Install Playwright separately or as an uncommitted local tool and start a production server. Existing smoke scripts use Google Chrome on macOS; set PLAYWRIGHT_MODULE to the installed Playwright module and TEST_ORIGIN to the server address. They mock Spotify; do not point them at a real user's session.

```sh
PLAYWRIGHT_MODULE=/path/to/playwright TEST_ORIGIN=http://127.0.0.1:3000 node scripts/beta-tools-smoke.cjs
```

Public demo and screenshot check: `scripts/public-demo-smoke.cjs`.

Additional checks: bin-gesture-smoke.cjs, bin-dividers-smoke.cjs, navigation-player-smoke.cjs. These browser scripts are currently manual checks; GitHub CI runs lint, Node tests, and the production build.

## Publishing checklist

- Review the working tree and history for secrets and personal data before the first push.
- Create the public repository under the intended owner, configure its remote, and push the reviewed application files.
- Enable Issues and verify CI passes on GitHub.
- Add a demo screenshot/short recording and link the live demo in the repository description.
- Choose a source-code license explicitly before inviting reuse; no license has been selected automatically.
- Tag a release after the GitHub checks pass. Do not claim a published release before pushing it.
