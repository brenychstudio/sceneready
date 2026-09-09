export type Brand<Value, Name extends string> = Value & { readonly __brand: Name };
