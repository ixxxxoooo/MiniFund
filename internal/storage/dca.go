package storage

import (
	"database/sql"
	"fmt"
	"time"

	"minifund/internal/model"
)

// ListDCAPlans 返回全部定投计划（联查基金名称，按创建时间升序）。
func (s *Store) ListDCAPlans() ([]model.DCAPlan, error) {
	rows, err := s.db.Query(`SELECT p.id, p.code, p.freq, p.day, p.amount, p.auto_record, p.enabled,
		COALESCE(p.next_run, ''), COALESCE(p.last_run, ''), COALESCE(p.created_at, 0), COALESCE(f.name, '')
		FROM dca_plan p LEFT JOIN fund_index f ON f.code = p.code ORDER BY p.created_at, p.id`)
	if err != nil {
		return nil, fmt.Errorf("查询定投计划失败: %w", err)
	}
	defer func() { _ = rows.Close() }()
	return scanPlans(rows)
}

// ListAllDCAPlans 返回全部定投计划（不联查名称，数据备份导出用）。
func (s *Store) ListAllDCAPlans() ([]model.DCAPlan, error) {
	rows, err := s.db.Query(`SELECT id, code, freq, day, amount, auto_record, enabled,
		COALESCE(next_run, ''), COALESCE(last_run, ''), COALESCE(created_at, 0), ''
		FROM dca_plan ORDER BY created_at, id`)
	if err != nil {
		return nil, fmt.Errorf("查询定投计划失败: %w", err)
	}
	defer func() { _ = rows.Close() }()
	return scanPlans(rows)
}

// scanPlans 读取定投计划结果集。
func scanPlans(rows *sql.Rows) ([]model.DCAPlan, error) {
	items := make([]model.DCAPlan, 0, 8)
	for rows.Next() {
		var p model.DCAPlan
		var auto, enabled int
		if err := rows.Scan(&p.ID, &p.Code, &p.Freq, &p.Day, &p.Amount, &auto, &enabled,
			&p.NextRun, &p.LastRun, &p.CreatedAt, &p.Name); err != nil {
			return nil, fmt.Errorf("读取定投计划失败: %w", err)
		}
		p.AutoRecord = auto != 0
		p.Enabled = enabled != 0
		items = append(items, p)
	}
	return items, rows.Err()
}

// UpsertDCAPlan 新增或更新定投计划（ID>0 为更新），返回写入后的计划 id。
// 下次执行日期由当前日期与周期推算。
func (s *Store) UpsertDCAPlan(p model.DCAPlan) (int64, error) {
	auto := boolToInt(p.AutoRecord)
	enabled := boolToInt(p.Enabled)
	nextRun := nextRunDate(p.Freq, p.Day, time.Now())
	if p.ID > 0 {
		_, err := s.db.Exec(`UPDATE dca_plan SET code=?, freq=?, day=?, amount=?, auto_record=?, enabled=?, next_run=? WHERE id=?`,
			p.Code, p.Freq, p.Day, p.Amount, auto, enabled, nextRun, p.ID)
		if err != nil {
			return 0, fmt.Errorf("更新定投计划失败: %w", err)
		}
		return p.ID, nil
	}
	res, err := s.db.Exec(`INSERT INTO dca_plan (code, freq, day, amount, auto_record, enabled, next_run, last_run, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, '', ?)`,
		p.Code, p.Freq, p.Day, p.Amount, auto, enabled, nextRun, time.Now().Unix())
	if err != nil {
		return 0, fmt.Errorf("新增定投计划失败: %w", err)
	}
	id, _ := res.LastInsertId()
	return id, nil
}

// DeleteDCAPlan 删除定投计划。
func (s *Store) DeleteDCAPlan(id int64) error {
	if _, err := s.db.Exec("DELETE FROM dca_plan WHERE id = ?", id); err != nil {
		return fmt.Errorf("删除定投计划失败: %w", err)
	}
	return nil
}

// SetDCAPlanEnabled 启用/停用定投计划。
func (s *Store) SetDCAPlanEnabled(id int64, enabled bool) error {
	if _, err := s.db.Exec("UPDATE dca_plan SET enabled = ? WHERE id = ?", boolToInt(enabled), id); err != nil {
		return fmt.Errorf("更新定投计划状态失败: %w", err)
	}
	return nil
}

// DueDCAPlans 返回到期（启用且 next_run ≤ today）的定投计划。
func (s *Store) DueDCAPlans(today string) ([]model.DCAPlan, error) {
	rows, err := s.db.Query(`SELECT id, code, freq, day, amount, auto_record, enabled,
		COALESCE(next_run, ''), COALESCE(last_run, ''), COALESCE(created_at, 0), ''
		FROM dca_plan WHERE enabled = 1 AND next_run != '' AND next_run <= ? ORDER BY id`, today)
	if err != nil {
		return nil, fmt.Errorf("查询到期定投计划失败: %w", err)
	}
	defer func() { _ = rows.Close() }()
	return scanPlans(rows)
}

// AdvanceDCAPlan 计划执行后推进：写 last_run，并按周期算出下一次 next_run。
func (s *Store) AdvanceDCAPlan(id int64, freq string, day int, today string) error {
	base, err := time.ParseInLocation("2006-01-02", today, time.Local)
	if err != nil {
		base = time.Now()
	}
	// 从次日起推算下一次执行日，避免同日重复触发
	next := nextRunDate(freq, day, base.AddDate(0, 0, 1))
	if _, err := s.db.Exec("UPDATE dca_plan SET last_run = ?, next_run = ? WHERE id = ?", today, next, id); err != nil {
		return fmt.Errorf("推进定投计划失败: %w", err)
	}
	return nil
}

// nextRunDate 从 from（含当日）起，算出符合周期的最近一个执行日期 yyyy-MM-dd。
func nextRunDate(freq string, day int, from time.Time) string {
	from = time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, time.Local)
	switch freq {
	case model.DCAFreqWeekly:
		target := day // 1..7 周一至周日
		if target < 1 || target > 7 {
			target = 1
		}
		// Go 中 Sunday=0，转换为周一=1..周日=7
		cur := int(from.Weekday())
		if cur == 0 {
			cur = 7
		}
		delta := (target - cur + 7) % 7
		return from.AddDate(0, 0, delta).Format("2006-01-02")
	case model.DCAFreqMonthly:
		target := day // 1..28
		if target < 1 {
			target = 1
		}
		if target > 28 {
			target = 28
		}
		candidate := time.Date(from.Year(), from.Month(), target, 0, 0, 0, 0, time.Local)
		if candidate.Before(from) {
			candidate = candidate.AddDate(0, 1, 0)
		}
		return candidate.Format("2006-01-02")
	default:
		return from.Format("2006-01-02")
	}
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
