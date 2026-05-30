# Contributing to ask'em

Thanks for your interest in improving ask'em. Please read this before opening a pull request.

## Development

```bash
pnpm install
pnpm dev        # run the extension
```

Before submitting, make sure these pass:

```bash
pnpm compile    # tsc --noEmit
pnpm test       # vitest
pnpm lint       # eslint
```

Keep changes focused, match the surrounding style, and add tests for behavior changes.
The architecture and design rationale live under [`docs/`](docs/) — skim
`docs/architecture/state-ownership.md` and the relevant design plan first.

## License of your contributions (Contributor License Agreement)

ask'em is released under the **AGPL-3.0** and uses maintainer-controlled
licensing rights so the maintainer can also offer it under a separate commercial
license (dual licensing). To make that possible, contributions are accepted
under the following agreement.

**By submitting a contribution** (a pull request, patch, or any work intentionally
submitted for inclusion), you agree that:

1. **You have the right to submit it** — it is your original work, or you have the
   necessary rights to contribute it, and submitting it does not violate any third
   party's rights or any agreement you are bound by.

2. **You grant the maintainer a broad license.** You retain copyright in your
   contribution, and you grant the project maintainer (Tuxi) a perpetual,
   worldwide, non-exclusive, royalty-free, irrevocable license to reproduce,
   prepare derivative works of, publicly display and perform, sublicense, and
   distribute your contribution and works derived from it.

3. **Including relicensing.** That license expressly allows the maintainer to license
   your contribution — and the project as a whole — under **any terms, including the
   AGPL-3.0, other open-source licenses, and proprietary/commercial licenses.** You will
   not be entitled to compensation for any such use. Recipients of public releases
   receive your contribution only under the license terms that accompany the release
   they receive, not under this maintainer relicensing grant.

4. **Patents.** You grant the maintainer a perpetual, worldwide, non-exclusive,
   royalty-free, irrevocable patent license, with the right to sublicense under the
   project's chosen license terms, to make, use, sell, and distribute your
   contribution, to the extent your patent claims are necessarily infringed by it.

You confirm your agreement by including this line in your pull request description (or a
`Signed-off-by` trailer in your commits):

```
I agree to the ask'em Contributor License Agreement in CONTRIBUTING.md.
```

If you are contributing on behalf of an employer, ensure you are authorized to grant
these rights.
