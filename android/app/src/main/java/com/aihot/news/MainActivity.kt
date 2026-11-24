package com.aihot.news

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Article
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Paid
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.Article
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.CacheControl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

enum class NewsCategory(
    val key: String,
    val label: String,
    val enLabel: String,
    val badge: String,
    val icon: ImageVector
) {
    GLOBAL("global", "全球榜", "GLOBAL", "全球一手", Icons.Default.Public),
    DOMESTIC("domestic", "国内榜", "CHINA", "国内前沿", Icons.Default.AccountBalance),
    BUSINESS("business", "商业榜", "VENTURE", "商业创投", Icons.AutoMirrored.Filled.TrendingUp),
    TECH("tech", "科技榜", "AI & TECH", "硬核科技", Icons.Default.Memory),
    MONEY("money", "搞钱榜", "MONETIZE", "搞钱变现", Icons.Default.Paid),
    CULTURE("culture", "文娱榜", "CULTURE", "数字文娱", Icons.Default.AutoAwesome)
}

data class ApiSource(val name: String? = "一手信源")
data class ApiLinks(val aihot: String? = null, val original: String? = null)

data class NewsItem(
    val id: String = "",
    val title: String = "",
    val originalTitle: String? = null,
    val summary: String? = null,
    val content: String? = null,
    val originalContent: String? = null,
    val paragraphs: List<String>? = null,
    val source: ApiSource? = null,
    val links: ApiLinks? = null,
    val publishedAt: String? = null,
    val discoveredAt: String? = null,
    val category: String? = "global",
    val tags: List<String>? = null,
    val score: Int? = 92,
    val reason: String? = null
)

data class ApiResponse(
    val generatedAt: String? = null,
    val items: List<NewsItem>? = emptyList()
)

data class ReportSection(
    val category: String? = "",
    val label: String? = "",
    val items: List<NewsItem>? = emptyList()
)

data class ReportMetrics(
    val totalEvents: Int? = 18,
    val sourcesCount: Int? = 30,
    val selectedCount: Int? = 18
)

data class ReportIssue(
    val kind: String? = "daily",
    val key: String? = "",
    val title: String? = "",
    val subtitle: String? = "",
    val overview: String? = "",
    val metrics: ReportMetrics? = null,
    val sections: List<ReportSection>? = emptyList()
)

data class ReportsEnvelope(
    val generatedAt: String? = "",
    val daily: ReportIssue? = null,
    val weekly: ReportIssue? = null,
    val monthly: ReportIssue? = null
)

data class FetchFeedResult(
    val items: List<NewsItem>,
    val channelLabel: String,
    val syncedTime: String
)

/**
 * 视觉主题色板：支持「曜石黑金 (Obsidian Executive)」与「金融宣纸 (Editorial Ivory)」双高定模式
 */
data class ExecutivePalette(
    val isDark: Boolean,
    val bgPrimary: Color,
    val bgSecondary: Color,
    val cardBg: Color,
    val cardBorder: Color,
    val mastheadBg: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textMuted: Color,
    val accentGold: Color,
    val accentGoldBg: Color,
    val accentEmerald: Color,
    val accentEmeraldBg: Color,
    val insightBg: Color,
    val chipBg: Color,
    val chipText: Color,
    val navBg: Color,
    val navIndicator: Color
)

val ObsidianExecutivePalette = ExecutivePalette(
    isDark = true,
    bgPrimary = Color(0xFF080C14),
    bgSecondary = Color(0xFF0D131F),
    cardBg = Color(0xFF111827),
    cardBorder = Color(0xFF1F2937),
    mastheadBg = Color(0xFF070A10),
    textPrimary = Color(0xFFF8FAFC),
    textSecondary = Color(0xFFCBD5E1),
    textMuted = Color(0xFF64748B),
    accentGold = Color(0xFFF59E0B),
    accentGoldBg = Color(0xFF271E0B),
    accentEmerald = Color(0xFF10B981),
    accentEmeraldBg = Color(0xFF082821),
    insightBg = Color(0xFF0D1422),
    chipBg = Color(0xFF1A2333),
    chipText = Color(0xFF94A3B8),
    navBg = Color(0xFF0B101B),
    navIndicator = Color(0xFF152C2B)
)

val EditorialIvoryPalette = ExecutivePalette(
    isDark = false,
    bgPrimary = Color(0xFFF5F3ED),
    bgSecondary = Color(0xFFFFFFFF),
    cardBg = Color(0xFFFFFFFF),
    cardBorder = Color(0xFFE6E2D8),
    mastheadBg = Color(0xFF0A1120),
    textPrimary = Color(0xFF0F172A),
    textSecondary = Color(0xFF334155),
    textMuted = Color(0xFF64748B),
    accentGold = Color(0xFFB45309),
    accentGoldBg = Color(0xFFFEF3C7),
    accentEmerald = Color(0xFF0F766E),
    accentEmeraldBg = Color(0xFFCCFBF1),
    insightBg = Color(0xFFF8F7F3),
    chipBg = Color(0xFFF1EFEA),
    chipText = Color(0xFF475569),
    navBg = Color(0xFFFFFFFF),
    navIndicator = Color(0xFFE6F4F1)
)

/**
 * 标题与摘要净化工具：剥离爬虫式【...】冗余前缀及尾部重复来源括注，还原彭博/金融时报级纯净版式
 */
data class ParsedHeadline(
    val kicker: String,
    val cleanTitle: String
)

private val GENERIC_KICKERS = setOf(
    "焦点", "快讯", "早报", "热闻", "钛晨报", "程序员", "股票", "职场话题", "问与答", "分享创造", "Google Gemini"
)

fun parseHeadline(rawTitle: String, sourceName: String?): ParsedHeadline {
    val trimmed = rawTitle.trim()
    val cnMatch = Regex("^【([^】]+)】\\s*(.*)$").find(trimmed)
    val sqMatch = if (cnMatch == null) Regex("^\\[([^\\]]+)]\\s*(.*)$").find(trimmed) else null
    val match = cnMatch ?: sqMatch
    val rawKicker = match?.groupValues?.getOrNull(1)?.trim()
    val bodyTitle = match?.groupValues?.getOrNull(2)?.trim()?.takeIf { it.isNotEmpty() } ?: trimmed
    val fallbackKicker = sourceName?.split("·")?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() } ?: "一手信源"
    val finalKicker = if (rawKicker.isNullOrBlank() || rawKicker in GENERIC_KICKERS) fallbackKicker else rawKicker
    return ParsedHeadline(
        kicker = finalKicker,
        cleanTitle = bodyTitle
    )
}

fun cleanSummaryText(rawSummary: String?): String {
    if (rawSummary.isNullOrBlank()) return ""
    return rawSummary
        .replace(Regex("（来源：[^）]+）\\s*$"), "")
        .replace(Regex("\\(来源:[^)]+\\)\\s*$"), "")
        .trim()
}

fun formatRelativeTime(publishedAt: String?, discoveredAt: String?): String {
    val candidates = listOfNotNull(
        publishedAt?.takeIf { it.isNotBlank() },
        discoveredAt?.takeIf { it.isNotBlank() }
    )
    if (candidates.isEmpty()) return "实时"
    val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }
    for (target in candidates) {
        try {
            val cleanIso = target.take(19)
            val parsed = sdf.parse(cleanIso) ?: continue
            val diffMinutes = ((System.currentTimeMillis() - parsed.time) / 60000L).coerceAtLeast(0L)
            return when {
                diffMinutes < 3L -> "刚刚"
                diffMinutes < 60L -> "${diffMinutes}分钟前"
                diffMinutes < 1440L -> "${diffMinutes / 60L}小时前"
                else -> {
                    val outFmt = SimpleDateFormat("MM-dd HH:mm", Locale.CHINA)
                    outFmt.format(parsed)
                }
            }
        } catch (_: Exception) {
            continue
        }
    }
    return "实时"
}

fun currentClockString(): String {
    return SimpleDateFormat("HH:mm:ss", Locale.CHINA).format(Date())
}

object NewsRepository {
    const val DEFAULT_CLOUD_RUN_URL = "https://zenglian-news-79709693345.asia-east1.run.app"
    private val CDN_BASES = listOf(
        "https://raw.githubusercontent.com/Zenglian990/zenglian-news/main/data-v2",
        "https://cdn.jsdelivr.net/gh/Zenglian990/zenglian-news@main/data-v2",
        "https://fastly.jsdelivr.net/gh/Zenglian990/zenglian-news@main/data-v2"
    )

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(14, TimeUnit.SECONDS)
        .build()

    private val gson = Gson()

    suspend fun fetchCategory(serverUrl: String, category: NewsCategory, query: String = ""): FetchFeedResult = withContext(Dispatchers.IO) {
        val base = serverUrl.trimEnd('/')
        val nowMs = System.currentTimeMillis()
        val clock = currentClockString()

        // 1. 第一优先级：直连 Cloud Run 实时双语数据库流 (/api/site/mobile/feed) —— 0 秒延迟，带完整双语正文
        try {
            val qParam = if (query.isNotBlank()) "&q=${Uri.encode(query)}" else ""
            val liveUrl = "$base/api/site/mobile/feed?category=${category.key}&limit=25$qParam&_t=$nowMs"
            val req = Request.Builder()
                .url(liveUrl)
                .cacheControl(CacheControl.FORCE_NETWORK)
                .header("Accept", "application/json")
                .header("Cache-Control", "no-cache")
                .build()
            client.newCall(req).execute().use { resp ->
                if (resp.isSuccessful) {
                    val body = resp.body?.string().orEmpty()
                    val parsed = gson.fromJson(body, ApiResponse::class.java)
                    val list = parsed?.items.orEmpty()
                    if (list.isNotEmpty()) {
                        return@withContext FetchFeedResult(
                            items = list,
                            channelLabel = "谷歌云亚太实时流",
                            syncedTime = clock
                        )
                    }
                }
            }
        } catch (_: Exception) {}

        // 2. 第二优先级：直连 Cloud Run 标准接口 (/api/v1/items)
        try {
            val url = if (query.isNotBlank()) {
                "$base/api/v1/items?mode=all&q=${Uri.encode(query)}&limit=25&_t=$nowMs"
            } else {
                "$base/api/v1/items?category=${category.key}&limit=25&_t=$nowMs"
            }
            val req = Request.Builder()
                .url(url)
                .cacheControl(CacheControl.FORCE_NETWORK)
                .header("Accept", "application/json")
                .build()
            client.newCall(req).execute().use { resp ->
                if (resp.isSuccessful) {
                    val body = resp.body?.string().orEmpty()
                    val parsed = gson.fromJson(body, ApiResponse::class.java)
                    val list = parsed?.items.orEmpty()
                    if (list.isNotEmpty()) {
                        return@withContext FetchFeedResult(
                            items = list,
                            channelLabel = "谷歌云 API 实时流",
                            syncedTime = clock
                        )
                    }
                }
            }
        } catch (_: Exception) {}

        // 3. 第三优先级（离线容灾兜底）：GitHub / jsDelivr 全球 CDN 快照
        for (cdn in CDN_BASES) {
            try {
                val req = Request.Builder()
                    .url("$cdn/${category.key}.json?_t=$nowMs")
                    .cacheControl(CacheControl.FORCE_NETWORK)
                    .build()
                client.newCall(req).execute().use { resp ->
                    if (resp.isSuccessful) {
                        val body = resp.body?.string().orEmpty()
                        val parsed = gson.fromJson(body, ApiResponse::class.java)
                        val list = parsed?.items.orEmpty()
                        if (list.isNotEmpty()) {
                            val filtered = if (query.isBlank()) list else list.filter {
                                it.title.contains(query, true) || (it.summary?.contains(query, true) == true)
                            }
                            return@withContext FetchFeedResult(
                                items = filtered,
                                channelLabel = "全球 CDN 镜像流",
                                syncedTime = clock
                            )
                        }
                    }
                }
            } catch (_: Exception) {}
        }

        FetchFeedResult(emptyList(), "连接重试中", clock)
    }

    suspend fun fetchReports(serverUrl: String): ReportsEnvelope? = withContext(Dispatchers.IO) {
        val base = serverUrl.trimEnd('/')
        val nowMs = System.currentTimeMillis()

        // 1. 优先直连 Cloud Run 实时简报接口
        try {
            val req = Request.Builder()
                .url("$base/api/site/mobile/reports?_t=$nowMs")
                .cacheControl(CacheControl.FORCE_NETWORK)
                .header("Accept", "application/json")
                .build()
            client.newCall(req).execute().use { resp ->
                if (resp.isSuccessful) {
                    val body = resp.body?.string().orEmpty()
                    val parsed = gson.fromJson(body, ReportsEnvelope::class.java)
                    if (parsed?.daily != null) return@withContext parsed
                }
            }
        } catch (_: Exception) {}

        // 2. 容灾回退到 CDN
        for (cdn in CDN_BASES) {
            try {
                val req = Request.Builder()
                    .url("$cdn/reports.json?_t=$nowMs")
                    .cacheControl(CacheControl.FORCE_NETWORK)
                    .build()
                client.newCall(req).execute().use { resp ->
                    if (resp.isSuccessful) {
                        val body = resp.body?.string().orEmpty()
                        return@withContext gson.fromJson(body, ReportsEnvelope::class.java)
                    }
                }
            } catch (_: Exception) {}
        }
        null
    }

    suspend fun pingServer(serverUrl: String): String = withContext(Dispatchers.IO) {
        val start = System.currentTimeMillis()
        try {
            val url = "${serverUrl.trimEnd('/')}/api/health"
            val req = Request.Builder().url(url).cacheControl(CacheControl.FORCE_NETWORK).build()
            client.newCall(req).execute().use { resp ->
                val ms = System.currentTimeMillis() - start
                if (resp.isSuccessful) "连接正常 (200 OK · 延迟 ${ms}ms)"
                else "返回状态码: ${resp.code} (${ms}ms)"
            }
        } catch (e: Exception) {
            "连接异常: ${e.message?.take(60)}"
        }
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                ZenglianNewsApp()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ZenglianNewsApp() {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("zenglian_news_prefs", Context.MODE_PRIVATE) }
    val gson = remember { Gson() }
    val scope = rememberCoroutineScope()

    var isDarkTheme by remember {
        mutableStateOf(prefs.getBoolean("executive_dark_mode", true))
    }
    val palette = if (isDarkTheme) ObsidianExecutivePalette else EditorialIvoryPalette
    val colorScheme = remember(isDarkTheme) {
        if (isDarkTheme) {
            darkColorScheme(
                primary = ObsidianExecutivePalette.accentGold,
                secondary = ObsidianExecutivePalette.accentEmerald,
                background = ObsidianExecutivePalette.bgPrimary,
                surface = ObsidianExecutivePalette.cardBg,
                onPrimary = Color(0xFF080C14),
                onSecondary = Color.White,
                onBackground = ObsidianExecutivePalette.textPrimary,
                onSurface = ObsidianExecutivePalette.textPrimary
            )
        } else {
            lightColorScheme(
                primary = EditorialIvoryPalette.accentEmerald,
                secondary = EditorialIvoryPalette.accentGold,
                background = EditorialIvoryPalette.bgPrimary,
                surface = EditorialIvoryPalette.cardBg,
                onPrimary = Color.White,
                onSecondary = Color.White,
                onBackground = EditorialIvoryPalette.textPrimary,
                onSurface = EditorialIvoryPalette.textPrimary
            )
        }
    }

    var serverUrl by remember {
        mutableStateOf(prefs.getString("server_url", NewsRepository.DEFAULT_CLOUD_RUN_URL) ?: NewsRepository.DEFAULT_CLOUD_RUN_URL)
    }
    var selectedTab by remember { mutableStateOf(0) }
    var currentCategory by remember { mutableStateOf(NewsCategory.GLOBAL) }
    var searchQuery by remember { mutableStateOf("") }
    var showSearchBar by remember { mutableStateOf(false) }

    var items by remember { mutableStateOf<List<NewsItem>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var channelLabel by remember { mutableStateOf("谷歌云亚太实时流") }
    var lastSyncedTime by remember { mutableStateOf(currentClockString()) }

    var reportsEnvelope by remember { mutableStateOf<ReportsEnvelope?>(null) }
    var reportPeriod by remember { mutableStateOf("daily") }

    var bookmarkedItems by remember {
        val raw = prefs.getString("bookmarks_json", "[]") ?: "[]"
        val type = object : TypeToken<List<NewsItem>>() {}.type
        val list: List<NewsItem> = try { gson.fromJson(raw, type) } catch (_: Exception) { emptyList() }
        mutableStateOf(list)
    }

    var activeArticle by remember { mutableStateOf<NewsItem?>(null) }
    var showServerDialog by remember { mutableStateOf(false) }

    fun toggleTheme() {
        val next = !isDarkTheme
        isDarkTheme = next
        prefs.edit().putBoolean("executive_dark_mode", next).apply()
    }

    fun saveBookmarks(updated: List<NewsItem>) {
        bookmarkedItems = updated
        prefs.edit().putString("bookmarks_json", gson.toJson(updated)).apply()
    }

    fun toggleBookmark(item: NewsItem) {
        val exists = bookmarkedItems.any { it.id == item.id }
        val next = if (exists) bookmarkedItems.filterNot { it.id == item.id } else listOf(item) + bookmarkedItems
        saveBookmarks(next)
    }

    fun loadCategory(cat: NewsCategory, q: String = searchQuery, silent: Boolean = false) {
        scope.launch {
            if (!silent) isLoading = true
            val result = NewsRepository.fetchCategory(serverUrl, cat, q)
            if (result.items.isNotEmpty()) {
                items = result.items
                channelLabel = result.channelLabel
                lastSyncedTime = result.syncedTime
                prefs.edit().putString("cache_${cat.key}", gson.toJson(result.items)).apply()
            } else if (!silent) {
                val cachedRaw = prefs.getString("cache_${cat.key}", null)
                if (!cachedRaw.isNullOrBlank()) {
                    val type = object : TypeToken<List<NewsItem>>() {}.type
                    items = try { gson.fromJson(cachedRaw, type) } catch (_: Exception) { emptyList() }
                    channelLabel = "本地离线缓存"
                    lastSyncedTime = currentClockString()
                } else {
                    items = emptyList()
                }
            }
            if (!silent) isLoading = false
        }
    }

    // 切换分类时立即拉取实时数据，并在前台每 3 分钟自动静默刷新一次
    LaunchedEffect(currentCategory, serverUrl) {
        loadCategory(currentCategory, searchQuery, silent = false)
        while (true) {
            delay(180_000L)
            loadCategory(currentCategory, searchQuery, silent = true)
        }
    }

    LaunchedEffect(selectedTab, serverUrl) {
        if (selectedTab == 1) {
            reportsEnvelope = NewsRepository.fetchReports(serverUrl)
        }
    }

    MaterialTheme(colorScheme = colorScheme) {
    Scaffold(
        containerColor = palette.bgPrimary,
        topBar = {
            ExecutiveMasthead(
                palette = palette,
                channelLabel = channelLabel,
                lastSyncedTime = lastSyncedTime,
                articleCount = items.size,
                showSearchBar = showSearchBar,
                searchQuery = searchQuery,
                onSearchQueryChange = { searchQuery = it },
                onToggleSearch = { showSearchBar = !showSearchBar },
                onTriggerSearch = {
                    selectedTab = 0
                    loadCategory(currentCategory, searchQuery)
                },
                onClearSearch = {
                    searchQuery = ""
                    loadCategory(currentCategory, "")
                },
                onRefresh = {
                    if (selectedTab == 1) {
                        scope.launch { reportsEnvelope = NewsRepository.fetchReports(serverUrl) }
                    } else {
                        loadCategory(currentCategory, searchQuery)
                    }
                },
                onToggleTheme = { toggleTheme() },
                onOpenSettings = { showServerDialog = true }
            )
        },
        bottomBar = {
            ExecutiveBottomBar(
                palette = palette,
                selectedTab = selectedTab,
                bookmarkCount = bookmarkedItems.size,
                onSelectTab = { selectedTab = it }
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(palette.bgPrimary)
                .padding(innerPadding)
        ) {
            when (selectedTab) {
                0 -> {
                    // 高定无 Emoji 矢量分类导航舱
                    ExecutiveCategoryBar(
                        palette = palette,
                        currentCategory = currentCategory,
                        onSelectCategory = { currentCategory = it }
                    )

                    if (isLoading) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                CircularProgressIndicator(
                                    color = palette.accentGold,
                                    strokeWidth = 2.5.dp,
                                    modifier = Modifier.size(32.dp)
                                )
                                Spacer(modifier = Modifier.height(12.dp))
                                Text(
                                    text = "正在直连 30 大权威源同步 ${currentCategory.badge} 情报...",
                                    color = palette.textMuted,
                                    fontSize = 12.sp
                                )
                            }
                        }
                    } else if (items.isEmpty()) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(
                                text = "暂无匹配情报，请点击右上角刷新或切换板块",
                                color = palette.textMuted,
                                fontSize = 14.sp
                            )
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            itemsIndexed(items, key = { idx, it -> "${it.id}_$idx" }) { index, item ->
                                val isBookmarked = bookmarkedItems.any { it.id == item.id }
                                if (index == 0 && searchQuery.isBlank()) {
                                    HeroLeadNewsCard(
                                        palette = palette,
                                        item = item,
                                        category = currentCategory,
                                        isBookmarked = isBookmarked,
                                        onBookmarkClick = { toggleBookmark(item) },
                                        onClick = { activeArticle = item }
                                    )
                                } else {
                                    EditorialNewsCard(
                                        palette = palette,
                                        rank = index + 1,
                                        item = item,
                                        isBookmarked = isBookmarked,
                                        onBookmarkClick = { toggleBookmark(item) },
                                        onClick = { activeArticle = item }
                                    )
                                }
                            }
                        }
                    }
                }

                1 -> {
                    ReportScreen(
                        palette = palette,
                        envelope = reportsEnvelope,
                        period = reportPeriod,
                        bookmarkedItems = bookmarkedItems,
                        onToggleBookmark = { toggleBookmark(it) },
                        onPeriodChange = { reportPeriod = it },
                        onArticleClick = { activeArticle = it }
                    )
                }

                2 -> {
                    if (bookmarkedItems.isEmpty()) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                modifier = Modifier.padding(36.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.BookmarkBorder,
                                    contentDescription = null,
                                    tint = palette.textMuted,
                                    modifier = Modifier.size(44.dp)
                                )
                                Spacer(modifier = Modifier.height(12.dp))
                                Text(
                                    text = "精读书签库为空",
                                    color = palette.textPrimary,
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = "在任意情报卡片右下角点击书签图标，即可永久保存在本地进行中英双语深度复盘。",
                                    color = palette.textMuted,
                                    fontSize = 13.sp,
                                    lineHeight = 20.sp
                                )
                            }
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            itemsIndexed(bookmarkedItems) { index, item ->
                                EditorialNewsCard(
                                    palette = palette,
                                    rank = index + 1,
                                    item = item,
                                    isBookmarked = true,
                                    onBookmarkClick = { toggleBookmark(item) },
                                    onClick = { activeArticle = item }
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    // 全屏沉浸式双语精读器
    activeArticle?.let { article ->
        FullScreenReaderDialog(
            palette = palette,
            item = article,
            isBookmarked = bookmarkedItems.any { it.id == article.id },
            onToggleBookmark = { toggleBookmark(article) },
            onDismiss = { activeArticle = null }
        )
    }

    if (showServerDialog) {
        ServerConfigDialog(
            palette = palette,
            currentUrl = serverUrl,
            onSave = { newUrl ->
                serverUrl = newUrl
                prefs.edit().putString("server_url", newUrl).apply()
                showServerDialog = false
                loadCategory(currentCategory, searchQuery)
            },
            onDismiss = { showServerDialog = false }
        )
    }
    }
}

@Composable
fun ExecutiveMasthead(
    palette: ExecutivePalette,
    channelLabel: String,
    lastSyncedTime: String,
    articleCount: Int,
    showSearchBar: Boolean,
    searchQuery: String,
    onSearchQueryChange: (String) -> Unit,
    onToggleSearch: () -> Unit,
    onTriggerSearch: () -> Unit,
    onClearSearch: () -> Unit,
    onRefresh: () -> Unit,
    onToggleTheme: () -> Unit,
    onOpenSettings: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    colors = listOf(Color(0xFF060911), Color(0xFF0C1322))
                )
            )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(start = 16.dp, end = 12.dp, top = 12.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    // 高定琥珀金竖向品牌徽标
                    Box(
                        modifier = Modifier
                            .width(3.5.dp)
                            .height(18.dp)
                            .clip(RoundedCornerShape(2.dp))
                            .background(
                                Brush.verticalGradient(
                                    listOf(Color(0xFFFBBF24), Color(0xFFD97706))
                                )
                            )
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "曾练全球一手新闻",
                        color = Color(0xFFF8FAFC),
                        fontSize = 19.sp,
                        fontWeight = FontWeight.ExtraBold,
                        letterSpacing = 0.4.sp
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Surface(
                        color = Color(0xFF1E293B),
                        shape = RoundedCornerShape(4.dp),
                        border = BorderStroke(0.8.dp, Color(0xFFF59E0B).copy(alpha = 0.6f))
                    ) {
                        Text(
                            text = "PRO v3.1",
                            color = Color(0xFFFBBF24),
                            fontSize = 9.5.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                }
                Spacer(modifier = Modifier.height(3.dp))
                Text(
                    text = "GLOBAL FIRST-HAND INTELLIGENCE · 全球商业与科技决策终端",
                    color = Color(0xFF94A3B8),
                    fontSize = 10.5.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    letterSpacing = 0.2.sp
                )
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                MastheadActionButton(
                    icon = if (palette.isDark) Icons.Default.LightMode else Icons.Default.DarkMode,
                    contentDescription = "切换黑金/宣纸主题",
                    tint = Color(0xFFFBBF24),
                    onClick = onToggleTheme
                )
                MastheadActionButton(
                    icon = Icons.Default.Search,
                    contentDescription = "全站搜索",
                    tint = Color(0xFFE2E8F0),
                    onClick = onToggleSearch
                )
                MastheadActionButton(
                    icon = Icons.Default.Refresh,
                    contentDescription = "实时同步",
                    tint = Color(0xFF34D399),
                    onClick = onRefresh
                )
                MastheadActionButton(
                    icon = Icons.Default.Settings,
                    contentDescription = "节点设置",
                    tint = Color(0xFF94A3B8),
                    onClick = onOpenSettings
                )
            }
        }

        // 彭博终端风格实时脉搏舱 (Live Telemetry Strip)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFF080D17))
                .padding(horizontal = 16.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(6.5.dp)
                        .clip(CircleShape)
                        .background(Color(0xFF10B981))
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = "LIVE",
                    color = Color(0xFF10B981),
                    fontSize = 10.sp,
                    fontWeight = FontWeight.ExtraBold,
                    fontFamily = FontFamily.Monospace
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = "$channelLabel · 30 大官方源直连",
                    color = Color(0xFF94A3B8),
                    fontSize = 11.sp
                )
            }

            Text(
                text = "同步于 $lastSyncedTime · ${articleCount}篇",
                color = Color(0xFF64748B),
                fontSize = 10.5.sp,
                fontFamily = FontFamily.Monospace
            )
        }

        if (showSearchBar) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF0B111E))
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = onSearchQueryChange,
                    placeholder = {
                        Text(
                            "检索 OpenAI、DeepSeek、英伟达、出海变现...",
                            color = Color(0xFF64748B),
                            fontSize = 13.sp
                        )
                    },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedBorderColor = Color(0xFFF59E0B),
                        unfocusedBorderColor = Color(0xFF1E293B)
                    ),
                    trailingIcon = {
                        if (searchQuery.isNotEmpty()) {
                            IconButton(onClick = onClearSearch) {
                                Icon(Icons.Default.Close, contentDescription = "清除", tint = Color(0xFF94A3B8))
                            }
                        }
                    },
                    modifier = Modifier.weight(1f)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Button(
                    onClick = onTriggerSearch,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFFD97706),
                        contentColor = Color.White
                    ),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text("检索", fontWeight = FontWeight.Bold)
                }
            }
        }

        HorizontalDivider(thickness = 0.8.dp, color = Color(0xFF1E293B))
    }
}

@Composable
fun MastheadActionButton(
    icon: ImageVector,
    contentDescription: String,
    tint: Color,
    onClick: () -> Unit
) {
    Surface(
        color = Color(0xFF151E2E),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(0.6.dp, Color(0xFF26334D)),
        modifier = Modifier
            .size(34.dp)
            .clickable { onClick() }
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                imageVector = icon,
                contentDescription = contentDescription,
                tint = tint,
                modifier = Modifier.size(17.dp)
            )
        }
    }
}

@Composable
fun ExecutiveCategoryBar(
    palette: ExecutivePalette,
    currentCategory: NewsCategory,
    onSelectCategory: (NewsCategory) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(palette.bgSecondary)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 14.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            NewsCategory.entries.forEach { cat ->
                val selected = cat == currentCategory
                val bgColor by animateColorAsState(
                    if (selected) {
                        if (palette.isDark) Color(0xFF1E293B) else Color(0xFF0F172A)
                    } else {
                        palette.chipBg
                    },
                    label = "catBg"
                )
                val borderColor = if (selected) {
                    if (palette.isDark) Color(0xFFF59E0B) else Color(0xFF0F172A)
                } else {
                    Color.Transparent
                }
                val contentColor = if (selected) {
                    if (palette.isDark) Color(0xFFFBBF24) else Color.White
                } else {
                    palette.chipText
                }

                Surface(
                    color = bgColor,
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, borderColor),
                    modifier = Modifier.clickable { onSelectCategory(cat) }
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = cat.icon,
                            contentDescription = cat.label,
                            tint = contentColor,
                            modifier = Modifier.size(15.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = cat.label,
                            color = contentColor,
                            fontSize = 13.sp,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium
                        )
                    }
                }
            }
        }
        HorizontalDivider(thickness = 0.6.dp, color = palette.cardBorder)
    }
}

/**
 * Top 01 领衔头条高定大卡 (Hero Lead Story Card)
 */
@Composable
fun HeroLeadNewsCard(
    palette: ExecutivePalette,
    item: NewsItem,
    category: NewsCategory,
    isBookmarked: Boolean,
    onBookmarkClick: () -> Unit,
    onClick: () -> Unit
) {
    val parsed = remember(item.title, item.source?.name) {
        parseHeadline(item.title, item.source?.name)
    }
    val cleanSummary = remember(item.summary) { cleanSummaryText(item.summary) }
    val relTime = remember(item.publishedAt, item.discoveredAt) {
        formatRelativeTime(item.publishedAt, item.discoveredAt)
    }
    val displayScore = item.score?.let { if (it <= 10) it * 10 else it } ?: 96
    val displayReason = remember(item.reason, parsed.cleanTitle) {
        item.reason?.takeIf { it.isNotBlank() }
            ?: "首席研判：深度追踪「${parsed.cleanTitle.take(18)}」核心商业与技术演进脉络。"
    }
    val displayTags = remember(item.tags) {
        item.tags.orEmpty()
            .filter { !it.startsWith("entity:") && it.length in 2..8 }
            .distinct()
            .take(2)
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() },
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(
            1.dp,
            if (palette.isDark) Color(0xFFD97706).copy(alpha = 0.5f) else Color(0xFFD97706).copy(alpha = 0.7f)
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF0E1628))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    Brush.linearGradient(
                        colors = listOf(
                            Color(0xFF15203B),
                            Color(0xFF0B111E)
                        )
                    )
                )
                .padding(16.dp)
        ) {
            // 顶部领衔头条金标行
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.weight(1f)
                ) {
                    Surface(
                        color = Color(0xFFD97706),
                        shape = RoundedCornerShape(4.dp)
                    ) {
                        Text(
                            text = "TOP 01 · ${category.badge}头条",
                            color = Color(0xFF080C14),
                            fontSize = 10.5.sp,
                            fontWeight = FontWeight.ExtraBold,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.5.dp)
                        )
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "${parsed.kicker} · $relTime",
                        color = Color(0xFF94A3B8),
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    displayTags.firstOrNull()?.let { tag ->
                        Surface(
                            color = Color(0xFF1E293B),
                            shape = RoundedCornerShape(4.dp)
                        ) {
                            Text(
                                text = tag,
                                color = Color(0xFFE2E8F0),
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                    }
                    Surface(
                        color = Color(0xFF064E3B),
                        shape = RoundedCornerShape(4.dp),
                        border = BorderStroke(0.6.dp, Color(0xFF10B981).copy(alpha = 0.5f))
                    ) {
                        Text(
                            text = "AI $displayScore",
                            color = Color(0xFF34D399),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp)
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // 出版级大标题
            Text(
                text = parsed.cleanTitle,
                color = Color(0xFFF8FAFC),
                fontSize = 18.5.sp,
                fontWeight = FontWeight.ExtraBold,
                lineHeight = 26.sp
            )

            if (!item.originalTitle.isNullOrBlank() && item.originalTitle != item.title) {
                Text(
                    text = item.originalTitle,
                    color = Color(0xFF94A3B8),
                    fontSize = 12.sp,
                    fontStyle = FontStyle.Italic,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 5.dp)
                )
            }

            if (cleanSummary.isNotBlank()) {
                Text(
                    text = cleanSummary,
                    color = Color(0xFFCBD5E1),
                    fontSize = 14.sp,
                    lineHeight = 21.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }

            // 底部投研研判与操作栏（始终展示，确保收藏按钮不缺失）
            Spacer(modifier = Modifier.height(12.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color(0xFF080D18))
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .width(2.5.dp)
                        .height(26.dp)
                        .background(Color(0xFFF59E0B))
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = displayReason,
                    color = Color(0xFFE2E8F0),
                    fontSize = 12.sp,
                    lineHeight = 17.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                IconButton(
                    onClick = onBookmarkClick,
                    modifier = Modifier.size(30.dp)
                ) {
                    Icon(
                        imageVector = if (isBookmarked) Icons.Default.Bookmark else Icons.Default.BookmarkBorder,
                        contentDescription = "收藏",
                        tint = if (isBookmarked) Color(0xFFFBBF24) else Color(0xFF64748B),
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }
    }
}

/**
 * 02–25 严选情报卡片 (Refined Editorial Card)
 */
@Composable
fun EditorialNewsCard(
    palette: ExecutivePalette,
    rank: Int,
    item: NewsItem,
    isBookmarked: Boolean,
    onBookmarkClick: () -> Unit,
    onClick: () -> Unit
) {
    val parsed = remember(item.title, item.source?.name) {
        parseHeadline(item.title, item.source?.name)
    }
    val cleanSummary = remember(item.summary) { cleanSummaryText(item.summary) }
    val relTime = remember(item.publishedAt, item.discoveredAt) {
        formatRelativeTime(item.publishedAt, item.discoveredAt)
    }
    val displayScore = item.score?.let { if (it <= 10) it * 10 else it } ?: 92
    val isTopThree = rank <= 3
    val displayReason = remember(item.reason, parsed.cleanTitle) {
        item.reason?.takeIf { it.isNotBlank() }
            ?: "精选研判：聚焦「${parsed.cleanTitle.take(18)}」的一手事实与行业演进信号。"
    }
    val primaryTag = remember(item.tags) {
        item.tags.orEmpty()
            .firstOrNull { !it.startsWith("entity:") && it.length in 2..7 }
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() },
        colors = CardDefaults.cardColors(containerColor = palette.cardBg),
        border = BorderStroke(0.8.dp, palette.cardBorder),
        elevation = CardDefaults.cardElevation(defaultElevation = if (palette.isDark) 0.dp else 1.5.dp),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(15.dp)) {
            // 第一行：高定等宽排名徽章 + 信源铭牌 + 相对时间 + 话题标签 + AI 评分
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.weight(1f)
                ) {
                    Surface(
                        color = if (isTopThree) palette.accentGoldBg else palette.chipBg,
                        shape = RoundedCornerShape(4.dp)
                    ) {
                        Text(
                            text = String.format("%02d", rank),
                            color = if (isTopThree) palette.accentGold else palette.textMuted,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.ExtraBold,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = parsed.kicker,
                        color = if (isTopThree) palette.accentGold else palette.accentEmerald,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = " · $relTime",
                        color = palette.textMuted,
                        fontSize = 11.5.sp,
                        maxLines = 1
                    )
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    primaryTag?.let { tag ->
                        Surface(
                            color = palette.chipBg,
                            shape = RoundedCornerShape(4.dp)
                        ) {
                            Text(
                                text = tag,
                                color = palette.chipText,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                    }
                    Surface(
                        color = palette.accentEmeraldBg,
                        shape = RoundedCornerShape(4.dp)
                    ) {
                        Text(
                            text = "AI $displayScore",
                            color = palette.accentEmerald,
                            fontSize = 10.5.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(9.dp))

            // 第二行：纯净出版级主标题（无【】爬虫前缀）
            Text(
                text = parsed.cleanTitle,
                color = palette.textPrimary,
                fontSize = 16.5.sp,
                fontWeight = FontWeight.Bold,
                lineHeight = 23.sp
            )

            // 第三行：外媒英文原题
            if (!item.originalTitle.isNullOrBlank() && item.originalTitle != item.title) {
                Text(
                    text = item.originalTitle,
                    color = palette.textMuted,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }

            // 第四行：高密度事实摘要
            if (cleanSummary.isNotBlank()) {
                Text(
                    text = cleanSummary,
                    color = palette.textSecondary,
                    fontSize = 14.sp,
                    lineHeight = 20.5.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 7.dp)
                )
            }

            // 第五行：左侧垂直金/青装饰线投研洞见栏 + 收藏按钮（始终展示）
            Row(
                modifier = Modifier
                    .padding(top = 10.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(6.dp))
                    .background(palette.insightBg)
                    .padding(horizontal = 10.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .width(2.5.dp)
                        .height(22.dp)
                        .background(if (isTopThree) palette.accentGold else palette.accentEmerald)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = displayReason,
                    color = palette.textSecondary,
                    fontSize = 12.sp,
                    lineHeight = 17.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                IconButton(
                    onClick = onBookmarkClick,
                    modifier = Modifier.size(28.dp)
                ) {
                    Icon(
                        imageVector = if (isBookmarked) Icons.Default.Bookmark else Icons.Default.BookmarkBorder,
                        contentDescription = "收藏",
                        tint = if (isBookmarked) palette.accentGold else palette.textMuted,
                        modifier = Modifier.size(17.dp)
                    )
                }
            }
        }
    }
}

/**
 * 全屏沉浸式双语精读器 (Full-Screen Editorial Reader)
 * 支持「双语对照」「中文精编」「外媒原文」三态切换
 */
@Composable
fun FullScreenReaderDialog(
    palette: ExecutivePalette,
    item: NewsItem,
    isBookmarked: Boolean,
    onToggleBookmark: () -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val parsed = remember(item.title, item.source?.name) {
        parseHeadline(item.title, item.source?.name)
    }
    val hasOriginal = !item.originalTitle.isNullOrBlank() && item.originalTitle != item.title
    // 0: 双语对照 (当有英文原文时默认), 1: 中文精编, 2: 外媒原文
    var readingMode by remember { mutableStateOf(if (hasOriginal) 0 else 1) }
    val displayScore = item.score?.let { if (it <= 10) it * 10 else it } ?: 92
    val relTime = remember(item.publishedAt, item.discoveredAt) {
        formatRelativeTime(item.publishedAt, item.discoveredAt)
    }

    val zhParagraphs = remember(item) {
        item.paragraphs?.takeIf { it.isNotEmpty() }
            ?: item.content?.split("\n\n")?.map { it.trim() }?.filter { it.isNotBlank() }
            ?: listOfNotNull(cleanSummaryText(item.summary)).filter { it.isNotBlank() }
    }
    val enParagraphs = remember(item) {
        item.originalContent?.split("\n\n")?.map { it.trim() }?.filter { it.isNotBlank() }.orEmpty()
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = palette.bgPrimary
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                // 顶部阅读器导航栏（包含系统状态栏安全内边距，适配刘海屏/挖孔屏）
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(palette.mastheadBg)
                        .statusBarsPadding()
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = onDismiss) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = "返回",
                                tint = Color.White
                            )
                        }
                        Column {
                            Text(
                                text = item.source?.name ?: parsed.kicker,
                                color = Color(0xFFFBBF24),
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = "$relTime · AI 价值评分 $displayScore",
                                color = Color(0xFF94A3B8),
                                fontSize = 11.sp
                            )
                        }
                    }

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = onToggleBookmark) {
                            Icon(
                                imageVector = if (isBookmarked) Icons.Default.Bookmark else Icons.Default.BookmarkBorder,
                                contentDescription = "收藏",
                                tint = if (isBookmarked) Color(0xFFFBBF24) else Color.White
                            )
                        }
                    }
                }

                // 语言模式切换栏（当存在外媒原文时显示）
                if (hasOriginal) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(palette.bgSecondary)
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        listOf(
                            0 to "中英双语对照",
                            1 to "中文深度精编",
                            2 to "外媒英文原文"
                        ).forEach { (mode, label) ->
                            val selected = readingMode == mode
                            Surface(
                                color = if (selected) palette.accentEmeraldBg else palette.chipBg,
                                shape = RoundedCornerShape(6.dp),
                                border = BorderStroke(
                                    0.8.dp,
                                    if (selected) palette.accentEmerald else Color.Transparent
                                ),
                                modifier = Modifier
                                    .weight(1f)
                                    .clickable { readingMode = mode }
                            ) {
                                Box(
                                    contentAlignment = Alignment.Center,
                                    modifier = Modifier.padding(vertical = 6.dp)
                                ) {
                                    Text(
                                        text = label,
                                        color = if (selected) palette.accentEmerald else palette.chipText,
                                        fontSize = 12.sp,
                                        fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium
                                    )
                                }
                            }
                        }
                    }
                    HorizontalDivider(thickness = 0.6.dp, color = palette.cardBorder)
                }

                // 沉浸式正文滚动区
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 18.dp, vertical = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    // 标题区
                    Text(
                        text = if (readingMode == 2 && hasOriginal) item.originalTitle!! else parsed.cleanTitle,
                        color = palette.textPrimary,
                        fontSize = 21.sp,
                        fontWeight = FontWeight.ExtraBold,
                        lineHeight = 29.sp
                    )

                    if (readingMode != 2 && hasOriginal) {
                        Text(
                            text = item.originalTitle!!,
                            color = palette.textMuted,
                            fontSize = 13.5.sp,
                            fontStyle = FontStyle.Italic,
                            lineHeight = 19.sp
                        )
                    }

                    // 商业与技术核心研判导读框
                    if (!item.reason.isNullOrBlank()) {
                        Surface(
                            color = palette.insightBg,
                            shape = RoundedCornerShape(10.dp),
                            border = BorderStroke(0.8.dp, palette.accentGold.copy(alpha = 0.4f)),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(modifier = Modifier.padding(14.dp)) {
                                Text(
                                    text = "EXECUTIVE TAKEAWAY · 核心投研研判",
                                    color = palette.accentGold,
                                    fontSize = 10.5.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    fontFamily = FontFamily.Monospace
                                )
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = item.reason,
                                    color = palette.textPrimary,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Medium,
                                    lineHeight = 21.sp
                                )
                            }
                        }
                    }

                    HorizontalDivider(thickness = 0.6.dp, color = palette.cardBorder)

                    // 正文段落渲染
                    when (readingMode) {
                        0 -> {
                            // 双语同屏深度精读
                            Text(
                                text = "中文深度精编",
                                color = palette.accentEmerald,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold
                            )
                            zhParagraphs.forEach { p ->
                                Text(
                                    text = p,
                                    color = palette.textPrimary,
                                    fontSize = 16.sp,
                                    lineHeight = 26.sp
                                )
                            }
                            if (enParagraphs.isNotEmpty()) {
                                Spacer(modifier = Modifier.height(8.dp))
                                HorizontalDivider(thickness = 0.6.dp, color = palette.cardBorder)
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = "ORIGINAL ENGLISH DISPATCH · 外媒一手原文",
                                    color = palette.accentGold,
                                    fontSize = 11.5.sp,
                                    fontWeight = FontWeight.Bold,
                                    fontFamily = FontFamily.Monospace
                                )
                                enParagraphs.forEach { ep ->
                                    Text(
                                        text = ep,
                                        color = palette.textSecondary,
                                        fontSize = 15.sp,
                                        lineHeight = 24.sp
                                    )
                                }
                            }
                        }

                        1 -> {
                            zhParagraphs.forEach { p ->
                                Text(
                                    text = p,
                                    color = palette.textPrimary,
                                    fontSize = 16.5.sp,
                                    lineHeight = 27.sp
                                )
                            }
                        }

                        2 -> {
                            val targetParas = if (enParagraphs.isNotEmpty()) enParagraphs else zhParagraphs
                            targetParas.forEach { ep ->
                                Text(
                                    text = ep,
                                    color = palette.textPrimary,
                                    fontSize = 16.sp,
                                    lineHeight = 25.sp
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(20.dp))
                }

                // 底部固定操作舱（包含手势导航栏安全内边距）
                Surface(
                    color = palette.bgSecondary,
                    border = BorderStroke(0.6.dp, palette.cardBorder),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .navigationBarsPadding()
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedButton(
                            onClick = onToggleBookmark,
                            border = BorderStroke(1.dp, palette.cardBorder),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(
                                imageVector = if (isBookmarked) Icons.Default.Bookmark else Icons.Default.BookmarkBorder,
                                contentDescription = null,
                                tint = if (isBookmarked) palette.accentGold else palette.textSecondary,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = if (isBookmarked) "已存书签" else "加入书签",
                                color = palette.textPrimary,
                                fontWeight = FontWeight.SemiBold
                            )
                        }

                        val origUrl = item.links?.original ?: item.links?.aihot
                        if (!origUrl.isNullOrBlank()) {
                            Button(
                                onClick = {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(origUrl)))
                                },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFF0F766E),
                                    contentColor = Color.White
                                ),
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.weight(1.3f)
                            ) {
                                Icon(Icons.Default.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("直达源站原文", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ExecutiveBottomBar(
    palette: ExecutivePalette,
    selectedTab: Int,
    bookmarkCount: Int,
    onSelectTab: (Int) -> Unit
) {
    Column {
        HorizontalDivider(thickness = 0.6.dp, color = palette.cardBorder)
        NavigationBar(
            containerColor = palette.navBg,
            tonalElevation = 0.dp
        ) {
            val itemColors = NavigationBarItemDefaults.colors(
                selectedIconColor = palette.accentEmerald,
                selectedTextColor = palette.accentEmerald,
                indicatorColor = palette.navIndicator,
                unselectedIconColor = palette.textMuted,
                unselectedTextColor = palette.textMuted
            )

            NavigationBarItem(
                selected = selectedTab == 0,
                onClick = { onSelectTab(0) },
                icon = {
                    Icon(
                        imageVector = if (selectedTab == 0) Icons.Filled.Bolt else Icons.Outlined.Bolt,
                        contentDescription = "实时流"
                    )
                },
                label = { Text("实时情报流", fontWeight = FontWeight.SemiBold, fontSize = 11.5.sp) },
                colors = itemColors
            )
            NavigationBarItem(
                selected = selectedTab == 1,
                onClick = { onSelectTab(1) },
                icon = {
                    Icon(
                        imageVector = if (selectedTab == 1) Icons.Filled.Article else Icons.Outlined.Article,
                        contentDescription = "周期研报"
                    )
                },
                label = { Text("日报·周报·月报", fontWeight = FontWeight.SemiBold, fontSize = 11.5.sp) },
                colors = itemColors
            )
            NavigationBarItem(
                selected = selectedTab == 2,
                onClick = { onSelectTab(2) },
                icon = {
                    Icon(
                        imageVector = if (selectedTab == 2) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder,
                        contentDescription = "精读书签"
                    )
                },
                label = { Text("精读书签 ($bookmarkCount)", fontWeight = FontWeight.SemiBold, fontSize = 11.5.sp) },
                colors = itemColors
            )
        }
    }
}

@Composable
fun ReportScreen(
    palette: ExecutivePalette,
    envelope: ReportsEnvelope?,
    period: String,
    bookmarkedItems: List<NewsItem>,
    onToggleBookmark: (NewsItem) -> Unit,
    onPeriodChange: (String) -> Unit,
    onArticleClick: (NewsItem) -> Unit
) {
    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(palette.bgSecondary)
                .padding(horizontal = 14.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            listOf(
                "daily" to "今日日报",
                "weekly" to "本周周报",
                "monthly" to "月度研报"
            ).forEach { (key, label) ->
                val selected = period == key
                Surface(
                    color = if (selected) Color(0xFF0F766E) else palette.chipBg,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier
                        .weight(1f)
                        .clickable { onPeriodChange(key) }
                ) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier.padding(vertical = 9.dp)
                    ) {
                        Text(
                            text = label,
                            color = if (selected) Color.White else palette.chipText,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        }
        HorizontalDivider(thickness = 0.6.dp, color = palette.cardBorder)

        val issue = when (period) {
            "weekly" -> envelope?.weekly
            "monthly" -> envelope?.monthly
            else -> envelope?.daily
        }

        if (issue == null) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = palette.accentGold)
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF0D1526)),
                        border = BorderStroke(1.dp, Color(0xFFD97706).copy(alpha = 0.4f)),
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                text = "EXECUTIVE BRIEFING · 权威周期简报",
                                color = Color(0xFFFBBF24),
                                fontSize = 10.5.sp,
                                fontWeight = FontWeight.ExtraBold,
                                fontFamily = FontFamily.Monospace
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(
                                text = issue.title ?: "曾练全球一手简报",
                                color = Color.White,
                                fontSize = 18.sp,
                                fontWeight = FontWeight.ExtraBold
                            )
                            if (!issue.subtitle.isNullOrBlank()) {
                                Text(
                                    text = issue.subtitle,
                                    color = Color(0xFF34D399),
                                    fontSize = 12.sp,
                                    modifier = Modifier.padding(top = 4.dp)
                                )
                            }
                            if (!issue.overview.isNullOrBlank()) {
                                Text(
                                    text = issue.overview,
                                    color = Color(0xFFCBD5E1),
                                    fontSize = 13.5.sp,
                                    lineHeight = 20.5.sp,
                                    modifier = Modifier.padding(top = 10.dp)
                                )
                            }
                        }
                    }
                }

                issue.sections.orEmpty().forEach { section ->
                    item {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(top = 8.dp, bottom = 2.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .width(3.dp)
                                    .height(16.dp)
                                    .background(palette.accentGold)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = (section.label ?: "精选板块").replace(Regex("^[^\\p{L}\\p{N}]+"), ""),
                                color = palette.textPrimary,
                                fontSize = 15.5.sp,
                                fontWeight = FontWeight.ExtraBold
                            )
                        }
                    }
                    itemsIndexed(section.items.orEmpty()) { idx, art ->
                        val isBookmarked = bookmarkedItems.any { it.id == art.id }
                        EditorialNewsCard(
                            palette = palette,
                            rank = idx + 1,
                            item = art,
                            isBookmarked = isBookmarked,
                            onBookmarkClick = { onToggleBookmark(art) },
                            onClick = { onArticleClick(art) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ServerConfigDialog(
    palette: ExecutivePalette,
    currentUrl: String,
    onSave: (String) -> Unit,
    onDismiss: () -> Unit
) {
    var inputUrl by remember { mutableStateOf(currentUrl) }
    var pingResult by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = palette.cardBg,
        titleContentColor = palette.textPrimary,
        textContentColor = palette.textSecondary,
        title = {
            Text(
                text = "云端实时情报节点配置",
                color = palette.textPrimary,
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = "曾先生，App 默认直连谷歌云亚太（台湾）高可用集群实时获取最新情报：",
                    fontSize = 13.sp,
                    color = palette.textSecondary
                )
                OutlinedTextField(
                    value = inputUrl,
                    onValueChange = { inputUrl = it },
                    label = { Text("实时集群地址 (HTTPS)", color = palette.textMuted) },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = palette.textPrimary,
                        unfocusedTextColor = palette.textPrimary,
                        focusedBorderColor = palette.accentGold,
                        unfocusedBorderColor = palette.cardBorder
                    ),
                    modifier = Modifier.fillMaxWidth()
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { inputUrl = NewsRepository.DEFAULT_CLOUD_RUN_URL },
                        border = BorderStroke(1.dp, palette.cardBorder)
                    ) {
                        Text("谷歌云亚太主节点", fontSize = 12.sp, color = palette.textPrimary)
                    }
                    OutlinedButton(
                        onClick = {
                            pingResult = "正在探测节点延迟..."
                            scope.launch {
                                pingResult = NewsRepository.pingServer(inputUrl)
                            }
                        },
                        border = BorderStroke(1.dp, palette.accentGold.copy(alpha = 0.6f))
                    ) {
                        Text("测试连通性", fontSize = 12.sp, color = palette.accentGold)
                    }
                }
                if (pingResult.isNotBlank()) {
                    Text(
                        text = pingResult,
                        color = if (pingResult.contains("200 OK")) palette.accentEmerald else Color(0xFFEF4444),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(inputUrl.trim()) },
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF0F766E),
                    contentColor = Color.White
                )
            ) {
                Text("保存并实时同步")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消", color = palette.textMuted)
            }
        }
    )
}
