// Basic types for invoice templates

// Export the log function for WebAssembly debugging
export declare function log(message: string): void;

// Invoice data models
@json
export class InvoiceItem {
  id: string = "";
  description: string = "";
  quantity: f64 = 0;
  unitPrice: f64 = 0;
  total: f64 = 0;
  category: string | null = null;
}

@json
export class Customer {
  name: string = "";
  address: string = "";
}

@json
export class TenantClient {
  name: string | null = null;
  address: string | null = null;
  logoUrl: string | null = null;
}

@json
export class InvoiceViewModel {
  invoiceNumber: string = "";
  issueDate: string = "";
  customer: Customer | null = null;
  tenantClient: TenantClient | null = null;
  items: Array<InvoiceItem> = [];
  notes: string | null = null;
  subtotal: f64 = 0;
  tax: f64 = 0;
  total: f64 = 0;
  creditApplied: f64 = 0;
}

// Layout element base classes
export abstract class LayoutElement {
  id: string = "";
  style: ElementStyle | null = null;
  
  abstract toJsonString(): string;
}

@json
export class ElementStyle {
  width: string | null = null;
  textAlign: string | null = null;
  fontWeight: string | null = null;
  marginTop: string | null = null;
  paddingLeft: string | null = null;
  paddingRight: string | null = null;
  paddingTop: string | null = null;
  paddingBottom: string | null = null;
  borderBottom: string | null = null;
  borderTop: string | null = null;
  border: string | null = null;
  marginBottom: string | null = null;
}

export class TextElement extends LayoutElement {
  text: string;
  tag: string | null = null;
  
  constructor(text: string, tag: string | null = null) {
    super();
    this.text = text;
    this.tag = tag;
  }
  
  toJsonString(): string {
    return `{"type": "Text", "content": "${this.text}", "variant": "${this.tag || ""}", "id": "${this.id}"}`;
  }
}

export class ImageElement extends LayoutElement {
  src: string;
  alt: string;
  
  constructor(src: string, alt: string) {
    super();
    this.src = src;
    this.alt = alt;
  }
  
  toJsonString(): string {
    return `{"type": "Image", "src": "${this.src}", "alt": "${this.alt}", "id": "${this.id}"}`;
  }
}

export class ColumnElement extends LayoutElement {
  children: Array<LayoutElement>;
  span: i32 = 1;
  
  constructor(children: Array<LayoutElement>) {
    super();
    this.children = children;
  }
  
  toJsonString(): string {
    let childrenJson = "[";
    for (let i = 0; i < this.children.length; i++) {
      if (i > 0) childrenJson += ",";
      childrenJson += this.children[i].toJsonString();
    }
    childrenJson += "]";
    return `{"type": "Column", "span": ${this.span}, "children": ${childrenJson}, "id": "${this.id}"}`;
  }
}

export class RowElement extends LayoutElement {
  children: Array<LayoutElement>;
  
  constructor(children: Array<LayoutElement>) {
    super();
    this.children = children;
  }
  
  toJsonString(): string {
    let childrenJson = "[";
    for (let i = 0; i < this.children.length; i++) {
      if (i > 0) childrenJson += ",";
      childrenJson += this.children[i].toJsonString();
    }
    childrenJson += "]";
    return `{"type": "Row", "children": ${childrenJson}, "id": "${this.id}"}`;
  }
}

export class SectionElement extends LayoutElement {
  children: Array<LayoutElement>;
  
  constructor(children: Array<LayoutElement>) {
    super();
    this.children = children;
  }
  
  toJsonString(): string {
    let childrenJson = "[";
    for (let i = 0; i < this.children.length; i++) {
      if (i > 0) childrenJson += ",";
      childrenJson += this.children[i].toJsonString();
    }
    childrenJson += "]";
    return `{"type": "Section", "children": ${childrenJson}, "id": "${this.id}"}`;
  }
}

export class DocumentElement extends LayoutElement {
  children: Array<LayoutElement>;
  
  constructor(children: Array<LayoutElement>) {
    super();
    this.children = children;
  }
  
  toJsonString(): string {
    let childrenJson = "[";
    for (let i = 0; i < this.children.length; i++) {
      if (i > 0) childrenJson += ",";
      childrenJson += this.children[i].toJsonString();
    }
    childrenJson += "]";
    return `{"type": "Document", "children": ${childrenJson}, "id": "${this.id}"}`;
  }
}
