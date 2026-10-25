// Stand-in for `electron` when tests bundle src/main code (see ../run.mjs).
// `app.getPath` reads WYD_TEST_USERDATA lazily so each test can use its own folder.
export const app = {
  getPath: (_name: string) => process.env['WYD_TEST_USERDATA'] ?? '/tmp/wyd-test-userdata',
  getAppPath: () => process.cwd(),
  isPackaged: true
}
