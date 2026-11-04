import type { FolderRecord } from "@/lib/local/types";

/**
 * Folder hierarchy helpers. Folders nest via parentId (no FK — LWW rows can
 * arrive in any order, so a missing/deleted parent just renders the folder
 * at the top level, like todos' blockerId).
 *
 * Siblings order by sortOrder then name: never-dragged folders (sortOrder 0)
 * group first in name order, and one drag renumbers the sibling group 1..n,
 * pinning it — the same section semantics as todo/note rows.
 */

export interface FolderTreeNode {
  folder: FolderRecord;
  depth: number;
  children: FolderTreeNode[];
}

export interface FolderTree {
  roots: FolderTreeNode[];
  /** Depth-first order — for flat lists and <select> options. */
  order: FolderTreeNode[];
  byId: Map<string, FolderTreeNode>;
}

export function buildFolderTree(folders: FolderRecord[]): FolderTree {
  const byId = new Map<string, FolderTreeNode>();
  for (const f of folders) {
    byId.set(f.id, { folder: f, depth: 0, children: [] });
  }

  // Walking up from a proposed parent must never reach the node itself —
  // parentId cycles are impossible via the UI but an unlucky LWW merge
  // could produce one, and the tree walk must stay finite.
  const reaches = (
    node: FolderTreeNode,
    from: FolderTreeNode | null,
  ): boolean => {
    const visited = new Set<string>();
    let p = from;
    while (p && !visited.has(p.folder.id)) {
      if (p === node) return true;
      visited.add(p.folder.id);
      p = p.folder.parentId ? (byId.get(p.folder.parentId) ?? null) : null;
    }
    return false;
  };

  const roots: FolderTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.folder.parentId ? byId.get(node.folder.parentId) : null;
    if (parent && parent !== node && !reaches(node, parent)) {
      parent.children.push(node);
    } else {
      // No parent, unknown parent (mid-sync), or a cycle: top level.
      roots.push(node);
    }
  }

  const sortNodes = (nodes: FolderTreeNode[]): void => {
    nodes.sort(
      (a, b) =>
        a.folder.sortOrder - b.folder.sortOrder ||
        a.folder.name.localeCompare(b.folder.name),
    );
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);

  const order: FolderTreeNode[] = [];
  const walk = (nodes: FolderTreeNode[], depth: number): void => {
    for (const n of nodes) {
      n.depth = depth;
      order.push(n);
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);

  return { roots, order, byId };
}
