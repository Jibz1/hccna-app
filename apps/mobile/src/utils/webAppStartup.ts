interface WebAppStartupOptions {
  readonly initialize: () => Promise<void>;
  readonly render: () => void;
  readonly reportInitializationError: (cause: unknown) => void;
}

export async function runWebAppStartup({
  initialize,
  render,
  reportInitializationError,
}: WebAppStartupOptions): Promise<void> {
  try {
    await initialize();
  } catch (error) {
    reportInitializationError(error);
  } finally {
    render();
  }
}
