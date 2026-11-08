# Card C mitigation recheck

Product revision: `5fb6d1ebd88fbb072e5cafb18ff2cb28e219b4ce`

Alga Dev routing repair: `f1627486d2440b5b82734a29c0782482630e17eb`

`viewer-routing-verification.json` is superseded as current evidence by `../605341a1b06c379b4144e27dbb260beb77fef417-routing-diagnosis/routing-verification.json`. In this recheck, `space-new-tab` created a tab, but the subsequent pane ID was not stable/current. `behavioral-tests.json` records fresh T003 (8/8) and T017 (3/3) results on disposable local integration databases.

No fresh feature screenshots or `smoke-walkthrough.webm/.vtt/.json` were produced. The card `dev-server` was suspended and `review-app` concluded/suspended; ports 3835 and 23835 refused connections. The target QA pane was signed out and on another host. No app server was started, and no review-fixture SQL was run. The prior authenticated UI evidence under `a29e82f8c9633e6956b746a58ea76f9cd35accb9-ui-verified-20261103-1929/` is historical and includes an unverified reopened-form display.

The latest completed prior independent PRD verifier result is run `aa58b308-59dd-4cf1-8797-2406cddb5b50` at product revision `d5f31be3899244928f7147ff0422cc72a1599897`. A new board verifier attempt (`4e787c96-7f94-4b97-a948-2da8c3f0140c`) remained running without a packet or verdict and was cancelled at 22:56:41 UTC; its recorded status is `inconclusive`. Prior production acceptance remains pinned to exact product revision `a29e82f8c9633e6956b746a58ea76f9cd35accb9`.
