export interface PublishOptions {
  bundlePath: string;
  registryUrl?: string;
  apiKey?: string;
}

export async function publish(_opts: PublishOptions): Promise<{ success: boolean; message?: string }> {
  // Placeholder for registry upload
  return { success: true };
}

