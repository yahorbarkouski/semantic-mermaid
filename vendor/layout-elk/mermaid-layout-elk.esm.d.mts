/** Mermaid layout loaders: { name, loader, algorithm }; loader() resolves to a module with render(). */
declare const layouts: { name: string, algorithm: string, loader: () => Promise<{ render: (data: any, svg: any, helpers: any, options: any) => Promise<void> }> }[];
export default layouts;
