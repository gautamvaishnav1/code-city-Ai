export function getNodeName(node: any): string {
  if (!node) return '';
console.log('getNodeName', node.type, node,"babel-node.utils.ts");
  if (node.type === 'Identifier') {
    return node.name;
  }

  if (node.type === 'ThisExpression') {
    return 'this';
  }

  if (node.type === 'MemberExpression') {
    const objectName = getNodeName(node.object);
    const propertyName = getNodeName(node.property);

    if (!objectName) return propertyName;
    if (!propertyName) return objectName;

    return `${objectName}.${propertyName}`;
  }

  return '';
}

export function getParentClassName(nodePath: any): string | null {
  const classPath = nodePath.findParent((p: any) => {
    return p.isClassDeclaration?.() || p.isClassExpression?.();
  });

  return classPath?.node?.id?.name ?? null;
}