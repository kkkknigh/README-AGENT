declare module "better-sqlite3" {
  interface Statement {
    run(...params: unknown[]): unknown
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }

  interface DatabaseInstance {
    pragma(source: string): unknown
    exec(source: string): void
    prepare(source: string): Statement
    transaction<T extends (...args: never[]) => unknown>(fn: T): T
  }

  export default class Database implements DatabaseInstance {
    constructor(filename: string)
    pragma(source: string): unknown
    exec(source: string): void
    prepare(source: string): Statement
    transaction<T extends (...args: never[]) => unknown>(fn: T): T
  }
}
