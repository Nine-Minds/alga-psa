const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const clampDuration = (hoursInput: string, minutesInput: string) => {
  const parsedHours = parseInt(hoursInput, 10);
  const parsedMinutes = parseInt(minutesInput, 10);

  const hours = Number.isNaN(parsedHours) ? 0 : clamp(parsedHours, 0, 24);
  // When hours=24, force minutes to 0 to cap at exactly 24:00 (1440 minutes)
  const minutes = hours === 24 ? 0 : (Number.isNaN(parsedMinutes) ? 0 : clamp(parsedMinutes, 0, 59));
  const totalMinutes = (hours * 60) + minutes;

  return { hours, minutes, totalMinutes };
};
