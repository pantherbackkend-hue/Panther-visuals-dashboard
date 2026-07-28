export default async function globalTeardown() {
  if (global.__SERVER__) {
    await global.__SERVER__.close();
  }
  if (global.__MONGOD__) {
    await global.__MONGOD__.stop();
  }
}
