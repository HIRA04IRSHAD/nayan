// Shown while a photo is being read (2–60 s depending on how busy Gemini is). An indeterminate
// progressbar: there is no honest percentage to give, so none is announced.
export function ReadingProgress({ label }: { label: string }) {
  return (
    <div className="reading">
      <div className="reading-bar" role="progressbar" aria-label={label} aria-valuetext="कृपया रुकिए">
        <span />
      </div>
      <p className="reading-label">{label}</p>
      <p className="reading-hint">कृपया रुकिए, इसमें कुछ सेकंड लग सकते हैं।</p>
    </div>
  );
}
