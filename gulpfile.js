'use strict';
const gulp = require('gulp');
const fs = require('fs');
// const filter = require('gulp-filter');
// const sass = require('gulp-sass')(require('sass'));
// const concat = require('gulp-concat');
// const replace = require('gulp-replace');
// const rename = require('gulp-rename');
const eslint = require('gulp-eslint');
var inlinesource = require('gulp-inline-source');

const plugins = require('gulp-load-plugins')();
var del = require('del');

function copyFirstExisting(candidates, destination) {
    const source = candidates.find((entry) => fs.existsSync(entry.replace(/\/\*\*\/\*$/, '')));
    if (!source) {
        return Promise.resolve();
    }
    return gulp.src(source).pipe(gulp.dest(destination));
}

gulp.task('clean', () => del(['dist/*']));
gulp.task('eslint', function eslintTask() {
    return gulp.src(['./src/**/*.js', '!./src/**/*.spec.js'])
        .pipe(eslint())
        .pipe(eslint.format())
        .pipe(eslint.failAfterError());
});

gulp.task('html', () => gulp.src('./src/index.html').pipe(
    plugins.htmlmin({
        collapseWhitespace: true,
        minifyCSS: true,
        minifyJS: true
    })).pipe(gulp.dest('dist')));

gulp.task('assets', () => gulp.src('./src/assets/**/*').pipe(gulp.dest('dist/assets')));
gulp.task('runtime-config', () => gulp.src('./src/runtime-config.js').pipe(gulp.dest('dist')));
gulp.task('flatpickr', () => gulp.src('./node_modules/flatpickr/dist/**/*').pipe(gulp.dest('dist/lib/flatpickr')));
gulp.task('choices', () => copyFirstExisting(
    ['./node_modules/choices/dist/**/*', './node_modules/choices.js/public/assets/**/*'],
    'dist/lib/choices'
));
gulp.task('formiojs', () => gulp.src('./node_modules/formiojs/dist/**/*').pipe(gulp.dest('dist/lib/formiojs')));
gulp.task('seamless', () => gulp.src('./node_modules/seamless/build/**/*').pipe(gulp.dest('dist/lib/seamless')));
gulp.task('bootstrap', () => gulp.src('./node_modules/bootstrap/dist/**/*').pipe(gulp.dest('dist/lib/bootstrap')));
gulp.task('bootswatch', () => gulp.src('./node_modules/bootswatch/**/*').pipe(gulp.dest('dist/lib/bootswatch')));
//gulp.task('bootstrap-italia', () => gulp.src('./node_modules/bootstrap-italia/dist/**/*').pipe(gulp.dest('dist/lib/bootstrap-italia/dist')));
gulp.task('fa', () => gulp.src('./node_modules/font-awesome/**/*').pipe(gulp.dest('dist/lib/font-awesome')));
gulp.task('moment-timezone', () => copyFirstExisting(
    ['./node_modules/moment-timezone/builds/moment-timezone-with-data.min.js'],
    'dist/lib/moment-timezone/builds'
));
gulp.task('moment', () => copyFirstExisting(
    ['./node_modules/moment/min/moment-with-locales.min.js'],
    'dist/lib/moment/min'
));
gulp.task('fonts', () => gulp.src('./node_modules/font-awesome/fonts/*').pipe(gulp.dest('dist/fonts')));
gulp.task('inlinesource', function () {
    var options = {
        compress: false
    };
    return gulp.src('./dist/*.html')
        .pipe(inlinesource(options))
        .pipe(gulp.dest('./dist'));
});
gulp.task('build', gulp.series(
    'clean',
   // 'eslint',
    gulp.parallel(
        'html',
        'assets',
        'runtime-config',
        'flatpickr',
        'choices',
        'formiojs',
        'seamless',
        'bootstrap',
        'bootswatch',
        'fa',
        'moment-timezone',
        'moment',
        'fonts'
    )
));
