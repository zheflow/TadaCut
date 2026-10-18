/** A quiet accent for the app chrome; never enters the preview or an export. */
export function SakuraDecor() {
  return (
    <div className="sakura-decor" aria-hidden="true">
      <svg className="sakura-branch" viewBox="0 0 540 230" fill="none">
        <path d="M540 24C448 28 427 121 327 128S201 167 135 207M459 75C416 44 377 53 344 26M402 111C366 83 325 80 292 93M329 128C298 149 289 179 271 204" />
        {[
          [441, 63],
          [394, 103],
          [336, 125],
          [301, 91],
          [280, 180],
          [351, 29],
          [228, 162],
        ].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y}) rotate(${i * 29})`}>
            {[0, 72, 144, 216, 288].map((angle) => (
              <path
                key={angle}
                d="M0 0C-13-4-15-17-5-20L0-16L5-20C15-17 13-4 0 0Z"
                transform={`rotate(${angle})`}
                className="sakura-flower"
              />
            ))}
            <circle r="2" className="sakura-center" />
          </g>
        ))}
      </svg>
      <span className="sakura-petal petal-one" />
      <span className="sakura-petal petal-two" />
      <span className="sakura-petal petal-three" />
    </div>
  );
}
