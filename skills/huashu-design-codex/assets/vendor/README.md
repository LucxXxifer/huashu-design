# Third-party offline assets

The React and React DOM 18.3.1 production and development UMD files are copied from the v3.5.0 source tree and match the original npm distributions byte for byte. Their MIT terms and copyright notice are in [LICENSE.react](LICENSE.react). The Huashu components are covered by the separate [upstream MIT license](../../LICENSE.upstream).

The separate Node runtime pins `@babel/standalone` 7.29.0 to precompile JSX. The generated HTML embeds React, with its notice, and runs the resulting JavaScript without an in-page compiler.

Runtime file integrity (source: `alchaincyf/huashu-design@937113133ae446a69ea19d4ceed6cbd2ed3c7735`, path `assets/vendor/`):

| File | SHA-384 |
|---|---|
| `react.production.min.js` | `843ebfaf0e29a4c2c636eded5f972321bfae459ed491127a04f90ba60e2102effaa2729483894bb0702cf4404f4fcd8b` |
| `react-dom.production.min.js` | `bba69e7adb9a5e7437f26613f2ba7ab1b5da41edcd2fdb7e2015e69d8c709142361f0e1bb29d96be6c78c91405d6e026` |
| `react.development.js` | `hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L` |
| `react-dom.development.js` | `u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm` |
| `babel.min.js` | `9b4f0a89d88da8b76926a2eaf791bf2c48bc42f8e5ff1518965dd020bca932843ae50a2b27d2efb69d915d8181163d72` |

The four React files are shipped with the Codex Skill; Babel's digest is recorded solely to make source review reproducible. The source `integrity` attribute is SHA-384 and is preserved here as a provenance check.
