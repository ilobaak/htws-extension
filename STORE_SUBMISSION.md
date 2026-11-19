# Store submission runbook

1. Run `npm ci`, then `npm run verify:store`.
2. Load `dist` unpacked in Brave or Chrome and repeat the browser acceptance
   checks in `RELEASE_CHECKLIST.md`.
3. Use the published privacy policy at
   `https://ilobaak.github.io/htws-extension-site/privacy.html`. Confirm the
   store listing contains a monitored developer support contact and the public
   support page links to `https://github.com/ilobaak/htws-extension/issues`.
4. In the Chrome Web Store developer dashboard, verify two-step verification is
   enabled and upload `release/htws-1.0.1.zip`.
5. Copy the listing text, disclosure, permission justifications, and data-type
   selections from `STORE_LISTING.md`.
6. Upload the 128-pixel icon, four 1280-by-800 screenshots, 440-by-280 small
   promotional tile, and 1400-by-560 marquee image listed in `STORE_LISTING.md`,
   preserving the documented screenshot order.
7. Choose private or unlisted visibility for a limited reviewer test, or public
   visibility for launch. Confirm the selected regions and pricing.
8. Preview the listing at desktop and narrow widths. Confirm that the prominent
   data-use disclosure is visible without relying only on the privacy-policy
   link.
9. Submit for review. Do not change the package, privacy answers, or listing
   claims independently; they must remain consistent.

Publishing and account verification require the owner's Chrome Web Store
developer account and are deliberately not automated by this repository.
