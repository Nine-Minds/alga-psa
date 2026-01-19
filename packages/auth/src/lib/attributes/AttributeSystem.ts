abstract class Attribute<T, U> {
  constructor(public name: string) {}
  abstract getValue(obj: U): T;
}

class DBFieldAttribute<T, U> extends Attribute<T, U> {
  constructor(name: string, private fieldName: keyof U) {
    super(name);
  }
  getValue(obj: U): T {
    return obj[this.fieldName] as T;
  }
}

class ComputedAttribute<T, U> extends Attribute<T, U> {
  constructor(name: string, private computeFn: (obj: U) => T) {
    super(name);
  }
  getValue(obj: U): T {
    return this.computeFn(obj);
  }
}

class StaticAttribute<T, U> extends Attribute<T, U> {
  constructor(name: string, private value: T) {
    super(name);
  }
  getValue(obj: U): T {
    return this.value;
  }
}

export { Attribute, DBFieldAttribute, ComputedAttribute, StaticAttribute };