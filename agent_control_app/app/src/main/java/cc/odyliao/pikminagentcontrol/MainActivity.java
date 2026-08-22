package cc.odyliao.pikminagentcontrol;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    // Current Magisk installations use the first path. Older enrolled agents
    // (including Agent Leo) keep their private Agent directory under
    // /data/local/tmp/agent<ID>. The command is fixed by this App; user input
    // is never interpolated except a validated integer minute count.
    private static final String CONTROL_SEARCH =
            "for d in /data/adb/modules/pikmin_scanner_agent /data/local/tmp/agent*; do " +
            "if [ -x \"$d/control.sh\" ]; then exec \"$d/control.sh\" ";
    private static final String CONTROL_SEARCH_END =
            "; fi; done; echo error control-script-not-found; exit 127";
    private final ExecutorService commandExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService statusExecutor = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView statusView;
    private TextView detailView;
    private TextView locationView;
    private TextView gpsView;
    private TextView resultView;
    private TextView updatedView;
    private EditText minutesInput;
    private boolean commandRunning;
    private volatile Process statusProcess;
    private volatile boolean destroyed;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(buildContent());
        startStatusStream();
    }

    @Override protected void onDestroy() {
        destroyed = true;
        Process process = statusProcess;
        if (process != null) process.destroy();
        statusExecutor.shutdownNow();
        commandExecutor.shutdownNow();
        super.onDestroy();
    }

    private View buildContent() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(244, 248, 237));

        LinearLayout root = column(20);
        root.setPadding(dp(22), dp(28), dp(22), dp(28));
        scroll.addView(root, matchWrap());

        TextView title = text("Pikmin Scanner 控制", 28, Color.rgb(33, 71, 54));
        title.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(title);

        TextView subtitle = text("只控制這台手機的掃描，不會影響其他 Agent。", 15,
                Color.rgb(82, 103, 89));
        subtitle.setPadding(0, dp(6), 0, dp(20));
        root.addView(subtitle);

        LinearLayout card = column(12);
        card.setPadding(dp(20), dp(18), dp(20), dp(18));
        card.setBackground(rounded(Color.WHITE, 22, 0));
        root.addView(card, fullWidthWithBottom(18));

        statusView = text("正在確認…", 22, Color.rgb(45, 84, 65));
        statusView.setTypeface(Typeface.DEFAULT_BOLD);
        card.addView(statusView);
        detailView = text("需要 Magisk root 權限。", 14, Color.rgb(96, 110, 101));
        detailView.setPadding(0, dp(7), 0, 0);
        card.addView(detailView);

        locationView = liveStatusText("城市：等待第一個掃描點");
        locationView.setPadding(0, dp(16), 0, 0);
        card.addView(locationView);
        gpsView = liveStatusText("GPS：—");
        card.addView(gpsView);
        resultView = liveStatusText("最近結果：等待掃描完成");
        card.addView(resultView);
        updatedView = text("狀態尚未更新", 12, Color.rgb(125, 139, 130));
        updatedView.setPadding(0, dp(8), 0, 0);
        card.addView(updatedView);

        root.addView(section("交還 GPS 控制"));
        Button handoffGps = button("停止掃描並交還 GPS 給 Joystick", false);
        root.addView(handoffGps, fullWidthWithBottom(4));
        handoffGps.setOnClickListener(v -> runControl("handoff-gps", "掃描已停止，GPS 已交還給 Joystick"));
        TextView handoffNote = text("此操作會手動暫停掃描、停止目前 Agent，並清除掃描器最後寫入的 GPS。按下「繼續掃描」後，掃描器才會再次接管 GPS。",
                13, Color.rgb(96, 110, 101));
        handoffNote.setPadding(0, 0, 0, dp(12));
        root.addView(handoffNote);

        root.addView(section("快速暫停"));
        LinearLayout quick = new LinearLayout(this);
        quick.setOrientation(LinearLayout.HORIZONTAL);
        quick.setGravity(Gravity.CENTER);
        Button hour = button("暫停 1 小時", false);
        Button hundred = button("暫停 100 分鐘", false);
        quick.addView(hour, weightedButton(1));
        quick.addView(hundred, weightedButton(1));
        root.addView(quick, fullWidthWithBottom(12));
        hour.setOnClickListener(v -> runControl("pause 60", "已暫停 1 小時"));
        hundred.setOnClickListener(v -> runControl("pause 100", "已暫停 100 分鐘"));

        Button manual = button("暫停，直到我手動恢復", false);
        root.addView(manual, fullWidthWithBottom(12));
        manual.setOnClickListener(v -> runControl("pause-manual", "已暫停掃描"));

        root.addView(section("自訂時間"));
        LinearLayout custom = new LinearLayout(this);
        custom.setOrientation(LinearLayout.HORIZONTAL);
        custom.setGravity(Gravity.CENTER_VERTICAL);
        minutesInput = new EditText(this);
        minutesInput.setHint("分鐘，例如 45");
        minutesInput.setTextSize(17);
        minutesInput.setSingleLine(true);
        minutesInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        minutesInput.setPadding(dp(16), 0, dp(16), 0);
        minutesInput.setBackground(rounded(Color.WHITE, 14, Color.rgb(191, 215, 192)));
        custom.addView(minutesInput, new LinearLayout.LayoutParams(0, dp(52), 1));
        Button apply = button("套用", false);
        LinearLayout.LayoutParams applyParams = new LinearLayout.LayoutParams(dp(108), dp(52));
        applyParams.setMargins(dp(10), 0, 0, 0);
        custom.addView(apply, applyParams);
        root.addView(custom, fullWidthWithBottom(20));
        apply.setOnClickListener(v -> pauseCustom());

        Button resume = button("繼續掃描", true);
        root.addView(resume, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(58)));
        resume.setOnClickListener(v -> runControl("resume", "已恢復掃描"));

        TextView note = text("暫停會在目前步驟安全中止；時間到後 Agent 自動繼續。手機重開機不會清除尚未到期的暫停。",
                13, Color.rgb(96, 110, 101));
        note.setPadding(0, dp(18), 0, 0);
        root.addView(note);
        return scroll;
    }

    private void pauseCustom() {
        String raw = minutesInput.getText().toString().trim();
        int minutes;
        try { minutes = Integer.parseInt(raw); }
        catch (NumberFormatException e) {
            toast("請輸入 1 到 10080 分鐘");
            return;
        }
        if (minutes < 1 || minutes > 10080) {
            toast("請輸入 1 到 10080 分鐘");
            return;
        }
        runControl("pause " + minutes, "已暫停 " + minutes + " 分鐘");
    }

    private void runControl(String command, String successMessage) {
        if (commandRunning) return;
        commandRunning = true;
        detailView.setText("正在套用…");
        commandExecutor.execute(() -> {
            Result result = execute(command);
            handler.post(() -> {
                commandRunning = false;
                if (result.ok) {
                    toast(successMessage);
                    renderStatus(result.output);
                } else {
                    showError(result.output);
                }
            });
        });
    }

    private void startStatusStream() {
        statusExecutor.execute(() -> {
            StringBuilder errors = new StringBuilder();
            try {
                Process process = new ProcessBuilder(
                        "/system/bin/su", "-c", controlCommand("watch 5"))
                        .redirectErrorStream(true).start();
                statusProcess = process;
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(process.getInputStream()))) {
                    String line;
                    while (!destroyed && (line = reader.readLine()) != null) {
                        final String value = line;
                        if (value.startsWith("snapshot\t")) {
                            handler.post(() -> renderSnapshot(value));
                        } else {
                            if (errors.length() > 0) errors.append('\n');
                            errors.append(value);
                        }
                    }
                }
                int exit = process.waitFor();
                if (!destroyed && exit != 0) {
                    String detail = errors.toString().trim();
                    handler.post(() -> showError(detail));
                }
            } catch (Exception e) {
                if (!destroyed) {
                    String detail = e.getClass().getSimpleName() + ": " + e.getMessage();
                    handler.post(() -> showError(detail));
                }
            } finally {
                statusProcess = null;
            }
        });
    }

    private void renderSnapshot(String raw) {
        String[] parts = raw.split("\\t", -1);
        if (parts.length < 9 || !"snapshot".equals(parts[0])) return;
        renderStatus(parts[1]);
        String location = parts[2];
        String progress = parts[5];
        locationView.setText(location.isEmpty()
                ? "城市：等待第一個掃描點"
                : "城市：" + location + (progress.isEmpty() ? "" : "（" + progress + "）"));
        gpsView.setText(parts[3].isEmpty() || parts[4].isEmpty()
                ? "GPS：—" : "GPS：" + parts[3] + ", " + parts[4]);
        if (parts[6].isEmpty()) {
            resultView.setText("最近結果：等待掃描完成");
        } else {
            long rows = parseLong(parts[6]);
            String elapsed = parts[7].isEmpty() ? "" : "・耗時 " + parts[7] + " 秒";
            resultView.setText(rows == 0
                    ? "最近結果：本點沒有新增蘑菇" + elapsed
                    : "最近結果：新增 " + rows + " 筆" + elapsed);
        }
        long updated = parseLong(parts[8]);
        if (updated > 0) {
            String time = new SimpleDateFormat("HH:mm:ss", Locale.TAIWAN)
                    .format(new Date(updated * 1000));
            updatedView.setText("即時狀態更新：" + time);
        }
    }

    private Result execute(String command) {
        StringBuilder output = new StringBuilder();
        try {
            Process process = new ProcessBuilder("/system/bin/su", "-c", controlCommand(command))
                    .redirectErrorStream(true).start();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (output.length() > 0) output.append('\n');
                    output.append(line);
                }
            }
            int exit = process.waitFor();
            return new Result(exit == 0, output.toString().trim());
        } catch (Exception e) {
            return new Result(false, e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    private void renderStatus(String raw) {
        if (raw.startsWith("running")) {
            statusView.setText("掃描中");
            statusView.setTextColor(Color.rgb(22, 142, 94));
            detailView.setText("Agent 會正常領取並掃描下一個座標。");
            return;
        }
        if (raw.startsWith("paused manual")) {
            statusView.setText("已暫停");
            statusView.setTextColor(Color.rgb(218, 112, 41));
            detailView.setText("等待你按下「繼續掃描」。");
            return;
        }
        if (raw.startsWith("paused until ")) {
            String[] parts = raw.split(" ");
            long seconds = parts.length >= 4 ? parseLong(parts[3]) : 0;
            long minutes = Math.max(1, (seconds + 59) / 60);
            statusView.setText("暫停中");
            statusView.setTextColor(Color.rgb(218, 112, 41));
            detailView.setText(String.format(Locale.TAIWAN,
                    "約 %d 分鐘後自動恢復。", minutes));
            return;
        }
        showError(raw);
    }

    private String controlCommand(String args) {
        return CONTROL_SEARCH + args + CONTROL_SEARCH_END;
    }

    private void showError(String detail) {
        statusView.setText("無法控制 Agent");
        statusView.setTextColor(Color.rgb(190, 55, 48));
        if (detail.contains("Permission denied") || detail.contains("error=13")) {
            detail = "Root 權限尚未開啟；請在 Magisk 的「超級使用者」中允許 Pikmin Scanner 控制。";
        }
        detailView.setText(detail.isEmpty()
                ? "請確認 Agent 控制腳本已部署，並授予此 App root 權限。" : detail);
    }

    private long parseLong(String value) {
        try { return Long.parseLong(value); }
        catch (NumberFormatException e) { return 0; }
    }

    private TextView section(String value) {
        TextView view = text(value, 17, Color.rgb(45, 84, 65));
        view.setTypeface(Typeface.DEFAULT_BOLD);
        view.setPadding(0, dp(8), 0, dp(10));
        return view;
    }

    private TextView liveStatusText(String value) {
        TextView view = text(value, 15, Color.rgb(61, 84, 70));
        view.setPadding(0, dp(5), 0, 0);
        return view;
    }

    private Button button(String label, boolean primary) {
        Button view = new Button(this);
        view.setText(label);
        view.setTextSize(16);
        view.setAllCaps(false);
        view.setTextColor(primary ? Color.WHITE : Color.rgb(31, 105, 78));
        view.setBackground(rounded(primary ? Color.rgb(22, 155, 114) : Color.WHITE,
                16, primary ? 0 : Color.rgb(191, 215, 192)));
        return view;
    }

    private TextView text(String value, int sp, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setLineSpacing(0, 1.15f);
        return view;
    }

    private LinearLayout column(int gapDp) {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setShowDividers(LinearLayout.SHOW_DIVIDER_MIDDLE);
        layout.setDividerDrawable(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
        layout.setDividerPadding(dp(gapDp));
        return layout;
    }

    private GradientDrawable rounded(int color, int radiusDp, int strokeColor) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        if (strokeColor != 0) drawable.setStroke(dp(1), strokeColor);
        return drawable;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams fullWidthWithBottom(int bottomDp) {
        LinearLayout.LayoutParams params = matchWrap();
        params.setMargins(0, 0, 0, dp(bottomDp));
        return params;
    }

    private LinearLayout.LayoutParams weightedButton(int weight) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(54), weight);
        params.setMargins(dp(4), 0, dp(4), 0);
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void toast(String value) {
        Toast.makeText(this, value, Toast.LENGTH_SHORT).show();
    }

    private static final class Result {
        final boolean ok;
        final String output;
        Result(boolean ok, String output) { this.ok = ok; this.output = output; }
    }
}
