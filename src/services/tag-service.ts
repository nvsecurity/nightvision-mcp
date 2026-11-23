import { ApiClient } from './api-client.js';

/**
 * The tag every application created through this MCP server carries, so the
 * dashboard can show and filter the applications an AI coding agent set up.
 */
export const AGENT_CREATED_TAG = {
  name: 'Agent created',
  color: 'indigo',
  icon: 'code',
  description: 'Created by an AI coding agent (Claude Code, Codex or Cursor) through NightVision.'
} as const;

export type AgentCreatedTagResult =
  | { tagged: true; tag_id: string; tag: string }
  | { tagged: false; warning: string };

interface TagRow {
  id: string;
  key: string;
  name: string;
}

/**
 * Organization tag operations.
 */
export class TagService {
  constructor(private client: ApiClient) {}

  /**
   * Add the "Agent created" tag to an application, creating the tag in the
   * application's organization the first time. Never throws: tagging is a label
   * on top of target creation, so a failure comes back as a warning.
   */
  async tagAgentCreated(targetId: string, organizationId?: string | null): Promise<AgentCreatedTagResult> {
    try {
      // Tags belong to an organization, and the CLI's create output does not
      // say which one the new application is in, so read it from the API.
      const orgId = organizationId || (await this.targetOrganization(targetId));
      const headers = orgId ? { 'X-Active-Organization': orgId } : undefined;
      const tagId = await this.findOrCreateAgentCreatedTag(headers);
      const response = await this.client.apiRequest<any>(
        `tags/${encodeURIComponent(tagId)}/assign-to-targets/`,
        'POST',
        {},
        { targets: [targetId] },
        false,
        undefined,
        headers
      );
      const row = Array.isArray(response?.results) ? response.results[0] : null;
      if (row?.status === 'skipped') {
        return {
          tagged: false,
          warning: `Could not add the "${AGENT_CREATED_TAG.name}" tag to the application (${row.reason}).`
        };
      }
      return { tagged: true, tag_id: tagId, tag: AGENT_CREATED_TAG.name };
    } catch (error: any) {
      return {
        tagged: false,
        warning: `Could not add the "${AGENT_CREATED_TAG.name}" tag to the application: ${error.message}`
      };
    }
  }

  private async targetOrganization(targetId: string): Promise<string | null> {
    const target = await this.client.apiRequest<any>(`targets/${encodeURIComponent(targetId)}/`, 'GET');
    return target?.organization_id || null;
  }

  private async findAgentCreatedTag(headers?: Record<string, string>): Promise<string | null> {
    const response = await this.client.apiRequest<any>(
      'tags/',
      'GET',
      { filter: AGENT_CREATED_TAG.name, page_size: 100 },
      null,
      false,
      undefined,
      headers
    );
    const rows: TagRow[] = Array.isArray(response?.results) ? response.results : [];
    // Tag names are unique per organization ignoring case, over key and name
    // together, so the label is the row with no key and this name.
    const wanted = AGENT_CREATED_TAG.name.toLowerCase();
    const match = rows.find((row) => !row.key && row.name?.toLowerCase() === wanted);
    return match ? match.id : null;
  }

  private async findOrCreateAgentCreatedTag(headers?: Record<string, string>): Promise<string> {
    const existing = await this.findAgentCreatedTag(headers);
    if (existing) return existing;

    try {
      const created = await this.client.apiRequest<any>(
        'tags/',
        'POST',
        {},
        { ...AGENT_CREATED_TAG },
        false,
        undefined,
        headers
      );
      return created.id;
    } catch (error) {
      // Another agent may have created it between the lookup and the create.
      const raced = await this.findAgentCreatedTag(headers);
      if (raced) return raced;
      throw error;
    }
  }
}
