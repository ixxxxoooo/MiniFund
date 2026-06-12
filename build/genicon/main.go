// 托盘模板图标生成工具：绘制上升折线+箭头的单色 PNG（黑色 + alpha）。
// macOS 模板图标由系统按菜单栏亮暗自动着色。
// 用法：go run ./build/genicon（输出 internal/tray/assets/tray_template@2x.png，36x36 即 18pt@2x）
package main

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
)

const (
	finalSize = 36 // 18pt @2x
	scale     = 4  // 超采样倍数（抗锯齿）
	bigSize   = finalSize * scale
)

// stampCircle 在大图上以 (cx,cy) 为圆心盖一个实心圆（黑色不透明）。
func stampCircle(img *image.NRGBA, cx, cy, r float64) {
	for y := int(cy - r); y <= int(cy+r); y++ {
		for x := int(cx - r); x <= int(cx+r); x++ {
			if x < 0 || y < 0 || x >= bigSize || y >= bigSize {
				continue
			}
			dx, dy := float64(x)+0.5-cx, float64(y)+0.5-cy
			if dx*dx+dy*dy <= r*r {
				img.SetNRGBA(x, y, color.NRGBA{0, 0, 0, 255})
			}
		}
	}
}

// drawLine 用圆刷沿线段扫描，得到带圆头的粗线。
func drawLine(img *image.NRGBA, x1, y1, x2, y2, width float64) {
	length := math.Hypot(x2-x1, y2-y1)
	steps := int(length) + 1
	for i := 0; i <= steps; i++ {
		t := float64(i) / float64(steps)
		stampCircle(img, x1+(x2-x1)*t, y1+(y2-y1)*t, width/2)
	}
}

func main() {
	big := image.NewNRGBA(image.Rect(0, 0, bigSize, bigSize))

	s := float64(scale)
	lw := 3.2 * s // 线宽（最终约 3.2px）

	// 上升折线：左下 → 中部回落 → 右上
	pts := [][2]float64{{5, 27}, {13, 18}, {19, 23}, {31, 10}}
	for i := 0; i < len(pts)-1; i++ {
		drawLine(big, pts[i][0]*s, pts[i][1]*s, pts[i+1][0]*s, pts[i+1][1]*s, lw)
	}
	// 箭头头部（终点两条短线）
	drawLine(big, 31*s, 10*s, 24.5*s, 10*s, lw)
	drawLine(big, 31*s, 10*s, 31*s, 16.5*s, lw)

	// 4x4 box 下采样得到抗锯齿小图
	out := image.NewNRGBA(image.Rect(0, 0, finalSize, finalSize))
	for y := 0; y < finalSize; y++ {
		for x := 0; x < finalSize; x++ {
			var sum int
			for dy := 0; dy < scale; dy++ {
				for dx := 0; dx < scale; dx++ {
					sum += int(big.NRGBAAt(x*scale+dx, y*scale+dy).A)
				}
			}
			out.SetNRGBA(x, y, color.NRGBA{0, 0, 0, uint8(sum / (scale * scale))})
		}
	}

	dst := filepath.Join("internal", "tray", "assets", "tray_template@2x.png")
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		fmt.Println("创建目录失败:", err)
		os.Exit(1)
	}
	f, err := os.Create(dst)
	if err != nil {
		fmt.Println("创建文件失败:", err)
		os.Exit(1)
	}
	defer func() { _ = f.Close() }()
	if err := png.Encode(f, out); err != nil {
		fmt.Println("编码 PNG 失败:", err)
		os.Exit(1)
	}
	fmt.Println("托盘模板图标已生成:", dst)
}
