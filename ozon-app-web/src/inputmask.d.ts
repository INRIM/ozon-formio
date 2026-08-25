declare module 'inputmask' {
    interface InputmaskDefinition {
        validator?: string | ((chrs: string) => boolean);
        casing?: 'upper' | 'lower' | 'title';
        cardinality?: number;
        placeholder?: string;
        definitionSymbol?: string;
    }
    interface InputmaskOptions {
        mask?: string;
        alias?: string;
    }
    interface InputmaskStatic {
        new (mask: string, options?: InputmaskOptions): { mask(el: HTMLElement): void };
        extendDefinitions(definitions: Record<string, InputmaskDefinition>): void;
        extendAliases(aliases: Record<string, InputmaskOptions>): void;
        isValid(value: string, options: InputmaskOptions): boolean;
        prototype: {
            definitions: Record<string, InputmaskDefinition>;
            aliases: Record<string, InputmaskOptions>;
        };
    }
    const Inputmask: InputmaskStatic;
    export default Inputmask;
}
