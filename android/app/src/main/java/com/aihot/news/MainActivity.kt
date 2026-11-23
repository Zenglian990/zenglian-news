package com.aihot.news

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

enum class NewsCategory(val key: String, val label: String, val badge: String) {
    GLOBAL("global", "🌐 全球榜", "全球一手"),
    DOMESTIC("domestic", "🇨🇳 国内榜", "国内前沿"),
    BUSINESS("business", "💼 商业榜", "商业创投"),
    TECH("tech", "⚡ 科技榜", "硬核科技"),
    MONEY("money", "💰 搞钱榜", "搞钱变现"),
    CULTURE("culture", "🎭 文娱榜", "数字文娱")
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
    val category: String? = "global",
    val score: Int? = 92,
    val reason: String? = null
)

data class ApiResponse(
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

object NewsRepository {
    const val DEFAULT_CLOUD_RUN_URL = "https://zenglian-news-79709693345.asia-east1.run.app"
    private val CDN_BASES = listOf(
        "https://raw.githubusercontent.com/Zenglian990/zenglian-news/main/data-v2",
        "https://cdn.jsdelivr.net/gh/Zenglian990/zenglian-news@main/data-v2",
        "https://fastly.jsdelivr.net/gh/Zenglian990/zenglian-news@main/data-v2"
    )

    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val gson = Gson()

    suspend fun fetchCategory(serverUrl: String, category: NewsCategory, query: String = ""): List<NewsItem> = withContext(Dispatchers.IO) {
        val base = serverUrl.trimEnd('/')
        val ts = System.currentTimeMillis() / 60000

        // 1. 优先尝试带正文的 data-v2 JSON 快照或搜索接口
        if (query.isNotBlank()) {
            try {
                val url = "$base/api/v1/items?mode=all&q=${Uri.encode(query)}&limit=30"
                val req = Request.Builder().url(url).header("Accept", "application/json").build()
                client.newCall(req).execute().use { resp ->
                    if (resp.isSuccessful) {
                        val body = resp.body?.string().orEmpty()
                        val parsed = gson.fromJson(body, ApiResponse::class.java)
                        if (!parsed?.items.isNullOrEmpty()) return@withContext parsed.items!!
                    }
                }
            } catch (_: Exception) {}
        }

        for (cdn in CDN_BASES) {
            try {
                val req = Request.Builder().url("$cdn/${category.key}.json?_t=$ts").build()
                client.newCall(req).execute().use { resp ->
                    if (resp.isSuccessful) {
                        val body = resp.body?.string().orEmpty()
                        val parsed = gson.fromJson(body, ApiResponse::class.java)
                        val list = parsed?.items.orEmpty()
                        if (list.isNotEmpty()) {
                            return@withContext if (query.isBlank()) list else list.filter {
                                it.title.contains(query, true) || (it.summary?.contains(query, true) == true)
                            }
                        }
                    }
                }
            } catch (_: Exception) {}
        }

        // 2. 回退到 Cloud Run /api/v1/items 接口
        try {
            val url = "$base/api/v1/items?category=${category.key}&limit=20"
            val req = Request.Builder().url(url).header("Accept", "application/json").build()
            client.newCall(req).execute().use { resp ->
                if (resp.isSuccessful) {
                    val body = resp.body?.string().orEmpty()
                    val parsed = gson.fromJson(body, ApiResponse::class.java)
                    if (!parsed?.items.isNullOrEmpty()) return@withContext parsed.items!!
                }
            }
        } catch (_: Exception) {}

        emptyList()
    }

    suspend fun fetchReports(): ReportsEnvelope? = withContext(Dispatchers.IO) {
        val ts = System.currentTimeMillis() / 60000
        for (cdn in CDN_BASES) {
            try {
                val req = Request.Builder().url("$cdn/reports.json?_t=$ts").build()
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
            val req = Request.Builder().url(url).build()
            client.newCall(req).execute().use { resp ->
                val ms = System.currentTimeMillis() - start
                if (resp.isSuccessful) "连接成功 (200 OK · 延迟 ${ms}ms)"
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
            MaterialTheme(
                colorScheme = lightColorScheme(
                    primary = Color(0xFF0F766E),
                    secondary = Color(0xFF0369A1),
                    background = Color(0xFFFAF9F6),
                    surface = Color(0xFFFFFFFF)
                )
            ) {
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

    var serverUrl by remember {
        mutableStateOf(prefs.getString("server_url", NewsRepository.DEFAULT_CLOUD_RUN_URL) ?: NewsRepository.DEFAULT_CLOUD_RUN_URL)
    }
    var selectedTab by remember { mutableStateOf(0) } // 0: 实时流, 1: 日报·周报·月报, 2: 我的收藏
    var currentCategory by remember { mutableStateOf(NewsCategory.GLOBAL) }
    var searchQuery by remember { mutableStateOf("") }
    var showSearchBar by remember { mutableStateOf(false) }

    var items by remember { mutableStateOf<List<NewsItem>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var statusText by remember { mutableStateOf("正在从 30 大官方源为您实时严选 Top 20 精品情报...") }

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

    fun saveBookmarks(updated: List<NewsItem>) {
        bookmarkedItems = updated
        prefs.edit().putString("bookmarks_json", gson.toJson(updated)).apply()
    }

    fun toggleBookmark(item: NewsItem) {
        val exists = bookmarkedItems.any { it.id == item.id }
        val next = if (exists) bookmarkedItems.filterNot { it.id == item.id } else listOf(item) + bookmarkedItems
        saveBookmarks(next)
    }

    fun loadCategory(cat: NewsCategory, q: String = searchQuery) {
        scope.launch {
            isLoading = true
            statusText = if (q.isNotBlank()) "正在全站检索「$q」相关一手情报..." else "⚡ 正在直连 30 大官方源为您实时严选 ${cat.badge} Top 20..."
            val fetched = NewsRepository.fetchCategory(serverUrl, cat, q)
            if (fetched.isNotEmpty()) {
                items = fetched
                prefs.edit().putString("cache_${cat.key}", gson.toJson(fetched)).apply()
                statusText = "✅ 实时 ${cat.badge}严选完成 (${fetched.size} 篇) · 点击卡片进入中英双语深度精读"
            } else {
                val cachedRaw = prefs.getString("cache_${cat.key}", null)
                if (!cachedRaw.isNullOrBlank()) {
                    val type = object : TypeToken<List<NewsItem>>() {}.type
                    items = try { gson.fromJson(cachedRaw, type) } catch (_: Exception) { emptyList() }
                    statusText = "⚠️ 网络波动，已展示最新本地缓存 (${items.size} 篇)"
                } else {
                    items = emptyList()
                    statusText = "暂无匹配内容，请切换分类或刷新重试"
                }
            }
            isLoading = false
        }
    }

    LaunchedEffect(currentCategory) {
        loadCategory(currentCategory, searchQuery)
    }

    LaunchedEffect(selectedTab) {
        if (selectedTab == 1 && reportsEnvelope == null) {
            reportsEnvelope = NewsRepository.fetchReports()
        }
    }

    Scaffold(
        topBar = {
            Column(modifier = Modifier.background(Color(0xFF0F172A))) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .statusBarsPadding()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = "曾练全球一手新闻",
                                color = Color.White,
                                fontSize = 19.sp,
                                fontWeight = FontWeight.Bold
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Surface(
                                color = Color(0xFF0D9488),
                                shape = RoundedCornerShape(4.dp)
                            ) {
                                Text(
                                    text = "v3.0 旗舰版",
                                    color = Color.White,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                )
                            }
                        }
                        Text(
                            text = "全球科技与商业一手智能情报枢纽 · 双语深度精读",
                            color = Color(0xFF94A3B8),
                            fontSize = 11.sp,
                            modifier = Modifier.padding(top = 2.dp)
                        )
                    }

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { showSearchBar = !showSearchBar }) {
                            Icon(Icons.Default.Search, contentDescription = "全站搜索", tint = Color.White)
                        }
                        IconButton(onClick = { loadCategory(currentCategory, searchQuery) }) {
                            Icon(Icons.Default.Refresh, contentDescription = "刷新", tint = Color.White)
                        }
                        IconButton(onClick = { showServerDialog = true }) {
                            Icon(Icons.Default.Settings, contentDescription = "服务器设置", tint = Color.White)
                        }
                    }
                }

                if (showSearchBar) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedTextField(
                            value = searchQuery,
                            onValueChange = { searchQuery = it },
                            placeholder = { Text("搜索 AI、OpenAI、DeepSeek、搞钱...", color = Color(0xFF94A3B8), fontSize = 13.sp) },
                            singleLine = true,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = Color.White,
                                unfocusedTextColor = Color.White,
                                focusedBorderColor = Color(0xFF14B8A6),
                                unfocusedBorderColor = Color(0xFF334155)
                            ),
                            trailingIcon = {
                                if (searchQuery.isNotEmpty()) {
                                    IconButton(onClick = {
                                        searchQuery = ""
                                        loadCategory(currentCategory, "")
                                    }) {
                                        Icon(Icons.Default.Close, contentDescription = "清除", tint = Color.White)
                                    }
                                }
                            },
                            modifier = Modifier.weight(1f)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Button(
                            onClick = {
                                selectedTab = 0
                                loadCategory(currentCategory, searchQuery)
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0D9488))
                        ) {
                            Text("搜索")
                        }
                    }
                }
            }
        },
        bottomBar = {
            NavigationBar(containerColor = Color.White, tonalElevation = 8.dp) {
                NavigationBarItem(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    icon = { Text("⚡", fontSize = 18.sp) },
                    label = { Text("实时流", fontWeight = FontWeight.Medium) }
                )
                NavigationBarItem(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    icon = { Text("📰", fontSize = 18.sp) },
                    label = { Text("日报·周报·月报", fontWeight = FontWeight.Medium) }
                )
                NavigationBarItem(
                    selected = selectedTab == 2,
                    onClick = { selectedTab = 2 },
                    icon = { Icon(Icons.Default.Bookmark, contentDescription = "我的收藏") },
                    label = { Text("我的收藏 (${bookmarkedItems.size})", fontWeight = FontWeight.Medium) }
                )
            }
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xFFFAF9F6))
                .padding(innerPadding)
        ) {
            when (selectedTab) {
                0 -> {
                    // 六大核心板块横向切换栏
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color.White)
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        NewsCategory.entries.forEach { cat ->
                            val selected = cat == currentCategory
                            FilterChip(
                                selected = selected,
                                onClick = { currentCategory = cat },
                                label = {
                                    Text(
                                        text = cat.label,
                                        fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                                        color = if (selected) Color.White else Color(0xFF334155)
                                    )
                                },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = Color(0xFF0F766E),
                                    containerColor = Color(0xFFF1F5F9)
                                )
                            )
                        }
                    }

                    // 状态提示条
                    Surface(
                        color = Color(0xFFF0FDFA),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = statusText,
                            color = Color(0xFF0F766E),
                            fontSize = 12.sp,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp)
                        )
                    }

                    if (isLoading) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = Color(0xFF0F766E))
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(12.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            itemsIndexed(items) { index, item ->
                                NewsCard(
                                    rank = index + 1,
                                    item = item,
                                    isBookmarked = bookmarkedItems.any { it.id == item.id },
                                    onBookmarkClick = { toggleBookmark(item) },
                                    onClick = { activeArticle = item }
                                )
                            }
                        }
                    }
                }

                1 -> {
                    ReportScreen(
                        envelope = reportsEnvelope,
                        period = reportPeriod,
                        onPeriodChange = { reportPeriod = it },
                        onArticleClick = { activeArticle = it }
                    )
                }

                2 -> {
                    if (bookmarkedItems.isEmpty()) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(
                                text = "暂无收藏内容\n在任意新闻卡片右下方点击 ☆ 星标，即可永久保存到本地离线精读书签！",
                                color = Color(0xFF64748B),
                                fontSize = 14.sp,
                                modifier = Modifier.padding(32.dp)
                            )
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(12.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            itemsIndexed(bookmarkedItems) { index, item ->
                                NewsCard(
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

    // 沉浸式文章详情与中英双语切换 BottomSheet
    activeArticle?.let { article ->
        ArticleDetailDialog(
            item = article,
            isBookmarked = bookmarkedItems.any { it.id == article.id },
            onToggleBookmark = { toggleBookmark(article) },
            onDismiss = { activeArticle = null }
        )
    }

    if (showServerDialog) {
        ServerConfigDialog(
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

@Composable
fun NewsCard(
    rank: Int,
    item: NewsItem,
    isBookmarked: Boolean,
    onBookmarkClick: () -> Unit,
    onClick: () -> Unit
) {
    val displayScore = item.score?.let { if (it <= 10) it * 10 else it } ?: 92
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() },
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val rankText = when (rank) {
                        1 -> "🥇 01"
                        2 -> "🥈 02"
                        3 -> "🥉 03"
                        else -> String.format("%02d", rank)
                    }
                    Surface(
                        color = if (rank <= 3) Color(0xFFFEF3C7) else Color(0xFFF1F5F9),
                        shape = RoundedCornerShape(4.dp)
                    ) {
                        Text(
                            text = rankText,
                            color = if (rank <= 3) Color(0xFFB45309) else Color(0xFF475569),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = item.source?.name ?: "权威一手信源",
                        color = Color(0xFF64748B),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                }

                Surface(
                    color = Color(0xFFECFDF5),
                    shape = RoundedCornerShape(4.dp)
                ) {
                    Text(
                        text = "AI $displayScore 分",
                        color = Color(0xFF047857),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = item.title,
                color = Color(0xFF0F172A),
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                lineHeight = 22.sp
            )

            if (!item.originalTitle.isNullOrBlank() && item.originalTitle != item.title) {
                Text(
                    text = item.originalTitle,
                    color = Color(0xFF64748B),
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }

            if (!item.summary.isNullOrBlank()) {
                Text(
                    text = item.summary,
                    color = Color(0xFF334155),
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 6.dp)
                )
            }

            if (!item.reason.isNullOrBlank()) {
                Row(
                    modifier = Modifier
                        .padding(top = 8.dp)
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xFFF8FAFC))
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "💡 ${item.reason}",
                        color = Color(0xFF475569),
                        fontSize = 12.sp,
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
                            tint = if (isBookmarked) Color(0xFFD97706) else Color(0xFF94A3B8)
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ArticleDetailDialog(
    item: NewsItem,
    isBookmarked: Boolean,
    onToggleBookmark: () -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    var showOriginal by remember { mutableStateOf(false) }
    val hasOriginal = !item.originalTitle.isNullOrBlank() && item.originalTitle != item.title
    val displayScore = item.score?.let { if (it <= 10) it * 10 else it } ?: 92

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = onToggleBookmark) {
                    Text(if (isBookmarked) "★ 已收藏" else "☆ 收藏精读")
                }
                val origUrl = item.links?.original ?: item.links?.aihot
                if (!origUrl.isNullOrBlank()) {
                    Button(
                        onClick = {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(origUrl)))
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F766E))
                    ) {
                        Icon(Icons.Default.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("直达源站原文")
                    }
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("关闭")
            }
        },
        title = {
            Column {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "${item.source?.name ?: "一手信源"} · AI $displayScore 分",
                        color = Color(0xFF0F766E),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold
                    )
                    if (hasOriginal) {
                        FilterChip(
                            selected = showOriginal,
                            onClick = { showOriginal = !showOriginal },
                            label = { Text(if (showOriginal) "切换中文精编" else "查看外媒原文", fontSize = 11.sp) }
                        )
                    }
                }
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = if (showOriginal && hasOriginal) item.originalTitle!! else item.title,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    lineHeight = 25.sp
                )
            }
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 440.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (!item.reason.isNullOrBlank()) {
                    Surface(
                        color = Color(0xFFF0FDFA),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = "🎯 商业与技术研判：${item.reason}",
                            color = Color(0xFF0F766E),
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.padding(10.dp)
                        )
                    }
                }

                if (showOriginal && !item.originalContent.isNullOrBlank()) {
                    Text(
                        text = item.originalContent,
                        color = Color(0xFF1E293B),
                        fontSize = 15.sp,
                        lineHeight = 23.sp
                    )
                } else {
                    val paras = item.paragraphs?.takeIf { it.isNotEmpty() }
                        ?: item.content?.split("\n\n")?.filter { it.isNotBlank() }
                        ?: listOfNotNull(item.summary)

                    paras.forEach { p ->
                        Text(
                            text = p.trim(),
                            color = Color(0xFF1E293B),
                            fontSize = 15.sp,
                            lineHeight = 23.sp
                        )
                    }
                }
            }
        }
    )
}

@Composable
fun ReportScreen(
    envelope: ReportsEnvelope?,
    period: String,
    onPeriodChange: (String) -> Unit,
    onArticleClick: (NewsItem) -> Unit
) {
    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color.White)
                .padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            listOf("daily" to "一手日报", "weekly" to "一手周报", "monthly" to "一手月报").forEach { (key, label) ->
                val selected = period == key
                Button(
                    onClick = { onPeriodChange(key) },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (selected) Color(0xFF0F766E) else Color(0xFFF1F5F9),
                        contentColor = if (selected) Color.White else Color(0xFF334155)
                    ),
                    modifier = Modifier.weight(1f)
                ) {
                    Text(label, fontWeight = FontWeight.Bold)
                }
            }
        }

        val issue = when (period) {
            "weekly" -> envelope?.weekly
            "monthly" -> envelope?.monthly
            else -> envelope?.daily
        }

        if (issue == null) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Color(0xFF0F766E))
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                text = issue.title ?: "曾练全球一手简报",
                                color = Color.White,
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold
                            )
                            if (!issue.subtitle.isNullOrBlank()) {
                                Text(
                                    text = issue.subtitle,
                                    color = Color(0xFF5EEAD4),
                                    fontSize = 12.sp,
                                    modifier = Modifier.padding(top = 4.dp)
                                )
                            }
                            if (!issue.overview.isNullOrBlank()) {
                                Text(
                                    text = issue.overview,
                                    color = Color(0xFFCBD5E1),
                                    fontSize = 13.sp,
                                    lineHeight = 20.sp,
                                    modifier = Modifier.padding(top = 10.dp)
                                )
                            }
                        }
                    }
                }

                issue.sections.orEmpty().forEach { section ->
                    item {
                        Text(
                            text = section.label ?: "精选板块",
                            color = Color(0xFF0F766E),
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
                        )
                    }
                    itemsIndexed(section.items.orEmpty()) { idx, art ->
                        NewsCard(
                            rank = idx + 1,
                            item = art,
                            isBookmarked = false,
                            onBookmarkClick = {},
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
    currentUrl: String,
    onSave: (String) -> Unit,
    onDismiss: () -> Unit
) {
    var inputUrl by remember { mutableStateOf(currentUrl) }
    var pingResult by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("云端后端服务器设置", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = "曾先生，您可以在此查看并自主配置手机 App 连接的后端服务：",
                    fontSize = 13.sp,
                    color = Color(0xFF475569)
                )
                OutlinedTextField(
                    value = inputUrl,
                    onValueChange = { inputUrl = it },
                    label = { Text("后端服务地址 (HTTPS)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { inputUrl = NewsRepository.DEFAULT_CLOUD_RUN_URL }
                    ) {
                        Text("谷歌云台湾节点 ⚙️", fontSize = 12.sp)
                    }
                    OutlinedButton(
                        onClick = {
                            pingResult = "正在测试连接响应..."
                            scope.launch {
                                pingResult = NewsRepository.pingServer(inputUrl)
                            }
                        }
                    ) {
                        Text("测试连通性 (Ping)", fontSize = 12.sp)
                    }
                }
                if (pingResult.isNotBlank()) {
                    Text(
                        text = pingResult,
                        color = if (pingResult.contains("200 OK")) Color(0xFF047857) else Color(0xFFB91C1C),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(inputUrl.trim()) },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F766E))
            ) {
                Text("保存并连接")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}
