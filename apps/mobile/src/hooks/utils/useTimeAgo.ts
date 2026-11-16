import { useEffect, useState } from "react";

const TIME_LABEL = {
  year: {
    full: "year",
    short: "y",
  },
  month: {
    full: "month",
    short: "m",
  },
  day: {
    full: "day",
    short: "d",
  },
  hour: {
    full: "hr",
    short: "h",
  },
  min: {
    full: "min",
    short: "m",
  },
  sec: {
    full: "sec",
    short: "s",
  },
};

export enum TimeUnit {
  ONE_SECOND = 1000,
  ONE_MINUTE = TimeUnit.ONE_SECOND * 60,
  ONE_HOUR = TimeUnit.ONE_MINUTE * 60,
  ONE_DAY = TimeUnit.ONE_HOUR * 24,
}

/**
 * Formats a timestamp using `timeAgo`, and automatically updates it when the value is small.
 */

type TimeAgoOptions = {
  timeFrom: number | null;
  shouldEnd?: boolean;
  endLabel?: string;
  maxTimeUnit?: TimeUnit;
  options?: TimeAgoParams["options"];
};

export function useTimeAgo(params: TimeAgoOptions) {
  const { timeFrom, shouldEnd, endLabel, maxTimeUnit, options } = params;
  const [now, setNow] = useState(() => Date.now());

  // end interval when the difference between now and timeFrom is less than or equal to 0
  const continueInterval = shouldEnd ? (timeFrom ?? now) - now >= 0 : true;
  const intervalEnabled =
    !!timeFrom &&
    Math.abs(now - (timeFrom || now)) < TimeUnit.ONE_HOUR &&
    continueInterval;

  const formattedTime = timeAgo({
    epochMilliSecs: timeFrom,
    timeNow: now,
    endLabel,
    maxTimeUnit,
    options,
  });

  useEffect(() => {
    if (!timeFrom || !intervalEnabled) {
      return;
    }
    const interval = setInterval(() => {
      setNow(Date.now());
    }, TimeUnit.ONE_SECOND);
    return () => {
      clearInterval(interval);
    };
  }, [intervalEnabled, timeFrom]);

  return formattedTime;
}

type TimeAgoParams = {
  epochMilliSecs: number | null | undefined;
  timeNow?: number | null;
  endLabel?: string;
  maxTimeUnit?: TimeUnit;
  options?: {
    shortenDaysLabel?: boolean;
    shortenHoursLabel?: boolean;
    shortenMinutesLabel?: boolean;
    shortenSecondsLabel?: boolean;
  };
};

// TODO - this need a bit of modification to account for multiple display format types
export const timeAgo = ({
  epochMilliSecs,
  timeNow = Date.now(),
  endLabel = `< 1 sec`,
  maxTimeUnit = TimeUnit.ONE_DAY,
  options,
}: TimeAgoParams): string => {
  if (!epochMilliSecs) {
    return "";
  }

  timeNow = timeNow ?? Date.now();

  const labelType: Record<"day" | "hour" | "min" | "sec", "full" | "short"> = {
    day: options?.shortenDaysLabel ? "short" : "full",
    hour: options?.shortenHoursLabel ? "short" : "full",
    min: options?.shortenMinutesLabel ? "short" : "full",
    sec: options?.shortenSecondsLabel ? "short" : "full",
  };

  let timeUnit: [string, number][];
  let timeCol = Math.abs(timeNow - epochMilliSecs);

  if (timeCol >= maxTimeUnit && maxTimeUnit >= TimeUnit.ONE_DAY) {
    timeUnit = [
      [TIME_LABEL.day[labelType.day], TimeUnit.ONE_DAY],
      [TIME_LABEL.hour[labelType.hour], TimeUnit.ONE_HOUR],
    ];
  } else if (timeCol >= TimeUnit.ONE_HOUR) {
    timeUnit = [
      [TIME_LABEL.hour[labelType.hour], TimeUnit.ONE_HOUR],
      [TIME_LABEL.min[labelType.min], TimeUnit.ONE_MINUTE],
    ];
  } else {
    timeUnit = [
      [TIME_LABEL.min[labelType.min], TimeUnit.ONE_MINUTE],
      [TIME_LABEL.sec[labelType.sec], TimeUnit.ONE_SECOND],
    ];
  }

  const convertAmount = (amount: number, label: string, isShort: boolean) => {
    const spacing = isShort ? "" : " ";
    const pluralSuffix = !isShort && amount > 1 ? "s" : ""; // Add "s" only if NOT short

    return amount > 0 ? `${amount}${spacing}${label}${pluralSuffix}` : "";
  };

  const resultArr = timeUnit.map(([label, denom]) => {
    const whole = Math.floor(timeCol / denom);
    timeCol -= whole * denom;

    // Check if the label corresponds to a short version
    const isShort = Object.keys(labelType).some(
      (key) => TIME_LABEL[key as keyof typeof TIME_LABEL]?.short === label,
    );

    return convertAmount(whole, label, isShort);
  });

  const result = resultArr.join(" ").trim();

  return result || endLabel;
};
