# Nova web control (Next.js + Tailwind CSS)

The browser UI for the Nova AMR. `npm run build` exports static files into `../web`, which the
`nova_dashboard.py` ROS node serves on port 8080, so the robot needs no Node.js at runtime.

```bash
npm install
npm run build        # then: cd ~/nova_ws && colcon build --symlink-install --packages-select nova_bot
```

Development with hot reload: start the dashboard with `-p cors_origin:=http://localhost:3000`, then
`NEXT_PUBLIC_ROBOT_API=http://localhost:8080 npm run dev`. See the package README for details.

Code map: `src/app/*/page.tsx` (one route per section), `src/components/sections/` (section UIs),
`src/components/RobotProvider.tsx` (live SSE connection shared by all sections),
`src/components/MapView.tsx` (map canvas), `src/lib/api.ts` (API client).
