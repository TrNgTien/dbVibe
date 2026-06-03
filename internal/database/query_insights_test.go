package database

import "testing"

func TestFinalizeQueryInsights(t *testing.T) {
	t.Parallel()

	insights := newQueryInsights("test")
	insights.Queries = []QueryInsight{
		{Calls: 2, TotalTimeMS: 75, Rows: 10, RowsExamined: 100},
		{Calls: 1, TotalTimeMS: 25, Rows: 5, RowsExamined: 50},
	}

	finalizeQueryInsights(&insights)

	if !insights.Available {
		t.Fatal("finalizeQueryInsights() Available = false, want true")
	}
	if insights.Summary.StatementCount != 2 {
		t.Fatalf("StatementCount = %d, want 2", insights.Summary.StatementCount)
	}
	if insights.Summary.Calls != 3 {
		t.Fatalf("Calls = %d, want 3", insights.Summary.Calls)
	}
	if insights.Summary.AverageTimeMS != 100.0/3.0 {
		t.Fatalf("AverageTimeMS = %f, want %f", insights.Summary.AverageTimeMS, 100.0/3.0)
	}
	if insights.Queries[0].ImpactPercent != 75 {
		t.Fatalf("ImpactPercent = %f, want 75", insights.Queries[0].ImpactPercent)
	}
}

func TestFinalizeQueryInsightsEmptyMessage(t *testing.T) {
	t.Parallel()

	insights := newQueryInsights("test")
	finalizeQueryInsights(&insights)

	if insights.Message == "" {
		t.Fatal("finalizeQueryInsights() Message is empty")
	}
}

func TestDockerPortsContain(t *testing.T) {
	t.Parallel()

	ports := "0.0.0.0:3306->3306/tcp, [::]:3306->3306/tcp"
	if !dockerPortsContain(ports, 3306) {
		t.Fatal("dockerPortsContain() = false, want true")
	}
	if dockerPortsContain(ports, 5432) {
		t.Fatal("dockerPortsContain() = true, want false")
	}
}

func TestParseDockerStats(t *testing.T) {
	t.Parallel()

	resource, err := parseDockerStats("mysql_local", "0.80%\t274.7MiB / 320MiB\t85.84%\n")
	if err != nil {
		t.Fatalf("parseDockerStats() error = %v", err)
	}
	if resource.Source != "docker" || resource.ContainerName != "mysql_local" {
		t.Fatalf("source = %q/%q, want docker/mysql_local", resource.Source, resource.ContainerName)
	}
	if resource.CPUUsagePercent != 0.8 {
		t.Fatalf("CPUUsagePercent = %f, want 0.8", resource.CPUUsagePercent)
	}
	if resource.MemoryUsagePercent != 85.84 {
		t.Fatalf("MemoryUsagePercent = %f, want 85.84", resource.MemoryUsagePercent)
	}
	if resource.MemoryUsedBytes != 288043827 {
		t.Fatalf("MemoryUsedBytes = %d", resource.MemoryUsedBytes)
	}
	if resource.MemoryLimitBytes != 320*1024*1024 {
		t.Fatalf("MemoryLimitBytes = %d", resource.MemoryLimitBytes)
	}
}

func TestParseDockerBytes(t *testing.T) {
	t.Parallel()

	got, err := parseDockerBytes("7.531MiB")
	if err != nil {
		t.Fatalf("parseDockerBytes() error = %v", err)
	}
	if got != 7896825 {
		t.Fatalf("parseDockerBytes() = %d", got)
	}
}
