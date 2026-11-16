import { useEffect, useState } from "react";

import { scheduleIdleTask } from "@/utils/scheduleIdleTask";

export function useDeferredMount() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const task = scheduleIdleTask(
      () => {
        setIsReady(true);
      },
      {
        timeout: 250,
      },
    );

    return task.cancel;
  }, []);

  return isReady;
}
