export class Router {
  constructor() {
    this.routes = new Map(); // name -> factory(ctx)->Component root
    this.currentName = null;
    this.currentRoot = null;
  }

  add(name, factory) {
    this.routes.set(name, factory);
    return this;
  }

  go(name, ctx) {
    const f = this.routes.get(name);
    if (!f) throw new Error(`Route not found: ${name}`);
    this.currentName = name;
    this.currentRoot = f(ctx);
    return this.currentRoot;
  }
}
