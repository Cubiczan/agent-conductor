/**
 * Agent Conductor — Skill registry.
 *
 * Adapted from onchainmind's SkillRegistry
 * (https://codeberg.org/cubiczan/onchainmind, MIT): the same central
 * register/lookup/summary surface, re-pointed at filesystem-discovered
 * SKILL.md skills instead of compiled-in TypeScript skill classes.
 */

import { discoverSkillsFromRoots, loadSkill } from "./loader.ts";
import type { LoadedSkill, SkillMetadata } from "./types.ts";

export class SkillRegistry {
  private skills = new Map<string, SkillMetadata>();

  /** Re-scan skill roots for one project or a declared multi-root list. */
  refresh(projectRootOrRoots: string | readonly string[]): SkillMetadata[] {
    const roots = typeof projectRootOrRoots === "string" ? [projectRootOrRoots] : projectRootOrRoots;
    this.skills.clear();
    for (const metadata of discoverSkillsFromRoots(roots)) {
      this.skills.set(metadata.name, metadata);
    }
    return this.getAll();
  }

  register(metadata: SkillMetadata): void {
    this.skills.set(metadata.name, metadata);
  }

  get(name: string): SkillMetadata | undefined {
    return this.skills.get(name);
  }

  getAll(): SkillMetadata[] {
    return Array.from(this.skills.values());
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  listNames(): string[] {
    return Array.from(this.skills.keys());
  }

  /** Load the full SKILL.md body for a registered skill. */
  load(name: string): LoadedSkill | undefined {
    const metadata = this.skills.get(name);
    return metadata ? loadSkill(metadata) : undefined;
  }

  /** Frontmatter-level summary — safe to put in a model's context wholesale. */
  getSummary(): Array<Pick<SkillMetadata, "name" | "description" | "version" | "scope">> {
    return this.getAll().map(({ name, description, version, scope }) => ({
      name,
      description,
      version,
      scope,
    }));
  }
}

/** Shared registry instance used by the MCP server. */
export const skillRegistry = new SkillRegistry();
